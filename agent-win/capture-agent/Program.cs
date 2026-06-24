using System.Text.Json;
using CaptureAgent;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Questo capture-agent funziona solo su Windows.");
    return;
}

var cfg = AppConfigLoader.Load(args);
var capture = new WindowCaptureService();
var encoder = new FrameEncoder();
var gamepadMapper = new GamepadMapper();

// Serializzazione camelCase: il server Node.js usa msg.type (minuscolo),
// non msg.Type (PascalCase di default del C#).
var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
};

string Serialize(object obj) => JsonSerializer.Serialize(obj, jsonOptions);

var wsUri = BuildWebSocketUri(cfg.ServerUrl, "/ws/capture-agent", cfg.SessionId, cfg.AgentSecret);
await using var transport = new StreamTransport(wsUri);

var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

// Loop ESTERNO: riconnette il WebSocket solo in caso di errore di rete.
// NON si riconnette quando l'attach al gioco fallisce: in quel caso
// resta connesso e riprova l'attach finché non riesce.
while (!cts.IsCancellationRequested)
{
    try
    {
        await transport.ConnectAsync(cts.Token);
        await transport.SendJsonAsync(Serialize(new AgentStatus("ready", "capture agent online")), cts.Token);
        Console.WriteLine($"[capture] connesso al server, cerco la finestra di '{cfg.ProcessName}'...");

        // Avvia in parallelo l'ascolto dei comandi del mouse che arrivano dal
        // telefono dell'amico. È legato a QUESTO socket: se la connessione cade,
        // il loop esce e il loop esterno qui sotto riconnette e ne avvia uno nuovo.
        var inputSocket = transport.CurrentSocket;
        if (inputSocket is not null)
            _ = ReceiveInputLoop(inputSocket, capture, gamepadMapper, cts.Token);

        // Loop INTERNO: gestisce il ciclo di vita del gioco senza toccare il WS.
        while (!cts.IsCancellationRequested)
        {
            // Ogni tentativo riguarda DA ZERO tutti i processi attualmente in
            // esecuzione (nome esatto -> nome parziale -> titolo finestra), così
            // se il processo originale era un launcher che ne ha avviato un altro,
            // o si è chiuso e riavviato, lo troviamo comunque.
            //
            // SICUREZZA: NON usiamo più il ripiego "aggancia la finestra più
            // grande". Agganciava finestre qualsiasi (desktop incluso) quando non
            // trovava il gioco, col rischio di mostrare all'amico tutto il PC.
            // Meglio non mostrare niente che mostrare la finestra sbagliata.
            const int MaxAttachWaitMs = 45_000;
            const int AttachPollMs = 1_000;
            int waited = 0;
            bool attached = false;
            while (waited < MaxAttachWaitMs && !cts.IsCancellationRequested)
            {
                attached = capture.TryFindAndAttach(cfg.ProcessName, allowLargestWindowFallback: false);
                if (attached) break;
                await Task.Delay(AttachPollMs, cts.Token);
                waited += AttachPollMs;
            }

            if (!attached)
            {
                Console.WriteLine("[capture] nessuna finestra trovata entro 45s, riprovo tra 3s...");
                await transport.SendJsonAsync(
                    Serialize(new AgentStatus("error", "finestra non trovata entro 45s")),
                    cts.Token);
                await Task.Delay(3_000, cts.Token);
                continue; // riprova attach SENZA riconnettersi al WS
            }

            Console.WriteLine($"[capture] avvio streaming a {cfg.TargetFps} fps");
            await transport.SendJsonAsync(
                Serialize(new AgentStatus("started", "streaming avviato", capture.AttachedProcessId)),
                cts.Token);

            var targetFrameMs = 1000.0 / Math.Max(1, cfg.TargetFps);
            var frameStopwatch = System.Diagnostics.Stopwatch.StartNew();

            // Loop di cattura frame: continua finché la finestra agganciata esiste ancora.
            while (!cts.IsCancellationRequested && capture.IsAttachedWindowStillOpen())
            {
                frameStopwatch.Restart();

                var frame = capture.CaptureFrameJpeg(cfg.JpegQuality, cfg.MaxDimension);
                if (frame is not null)
                {
                    var payload = encoder.PackVideoFrame(frame);
                    await transport.SendBinaryAsync(payload, cts.Token);
                }

                // Aspettiamo solo il tempo RIMANENTE del budget del frame, non un
                // delay fisso sommato sopra: se catturare+codificare+inviare ha già
                // impiegato più del previsto, non aggiungiamo altro ritardo sopra,
                // così il ritardo non si accumula frame dopo frame.
                var elapsedMs = frameStopwatch.Elapsed.TotalMilliseconds;
                var remainingMs = targetFrameMs - elapsedMs;
                if (remainingMs > 0)
                    await Task.Delay(TimeSpan.FromMilliseconds(remainingMs), cts.Token);
            }

            Console.WriteLine("[capture] la finestra del gioco si è chiusa");
            await transport.SendJsonAsync(
                Serialize(new AgentStatus("ended", "finestra chiusa", capture.AttachedProcessId)),
                cts.Token);

            // SICUREZZA: quando il gioco si chiude, il capture-agent ESCE del tutto.
            // Niente nuovo aggancio, niente streaming di altre finestre, niente
            // più iniezione di tasti/mouse: così l'amico non può vedere il
            // desktop né "smanettare" sul PC dopo aver chiuso il gioco. Alla
            // prossima partita l'agent (agent.js) riavvia un capture-agent nuovo.
            cts.Cancel();
            break;
        }
    }
    catch (OperationCanceledException)
    {
        break;
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[capture] errore WS: {ex.Message} — riprovo in {cfg.ReconnectDelayMs}ms");
        try
        {
            await transport.SendJsonAsync(Serialize(new AgentStatus("error", ex.Message)), CancellationToken.None);
        }
        catch { }

        await Task.Delay(cfg.ReconnectDelayMs, cts.Token).ConfigureAwait(false);
        // loop esterno: riconnette il WebSocket
    }
}

// Ascolta i messaggi in arrivo dal server (inoltrati dal viewer) e li applica.
// Oggi gestisce solo il mouse; in futuro qui potrebbero arrivare anche tastiera
// o altri comandi.
static async Task ReceiveInputLoop(System.Net.WebSockets.ClientWebSocket socket, WindowCaptureService capture, GamepadMapper gamepadMapper, CancellationToken ct)
{
    try
    {
        while (!ct.IsCancellationRequested && socket.State == System.Net.WebSockets.WebSocketState.Open)
        {
            var text = await StreamTransport.ReceiveTextAsync(socket, ct);
            if (text is null) break; // socket chiuso
            HandleInputMessage(text, capture, gamepadMapper);
        }
    }
    catch
    {
        // connessione caduta o annullata: il loop esterno riconnette e riavvia.
    }
    finally
    {
        // se l'amico se ne va mentre teneva premuto, non lasciamo tasti incollati.
        gamepadMapper.ReleaseAll();
    }
}

static void HandleInputMessage(string text, WindowCaptureService capture, GamepadMapper gamepadMapper)
{
    try
    {
        using var doc = JsonDocument.Parse(text);
        var root = doc.RootElement;
        if (!root.TryGetProperty("type", out var typeEl)) return;
        string? type = typeEl.GetString();

        if (type == "mouse")
        {
            HandleMouseMessage(root, capture);
        }
        else if (type == "input")
        {
            // controller dell'amico -> tastiera + mouse del gioco
            if (!root.TryGetProperty("gamepad", out var gp)) return;
            double[] axes = ReadDoubleArray(gp, "axes");
            double[] buttons = ReadDoubleArray(gp, "buttons");
            // la sensibilità della visuale arriva (se presente) dentro ogni
            // messaggio: così segue subito lo slider del sito e sopravvive a
            // eventuali riconnessioni del capture.
            if (root.TryGetProperty("lookSensitivity", out var lsEl) && lsEl.ValueKind == JsonValueKind.Number)
                gamepadMapper.SetLookSensitivity(lsEl.GetDouble());
            // il gioco deve avere il focus, altrimenti i tasti vanno altrove.
            capture.EnsureForeground();
            gamepadMapper.Apply(axes, buttons);
        }
    }
    catch
    {
        // messaggio malformato: lo ignoriamo, non deve far cadere il loop.
    }
}

static void HandleMouseMessage(JsonElement root, WindowCaptureService capture)
{
    string action = root.TryGetProperty("action", out var aEl) ? (aEl.GetString() ?? "click") : "click";
    double x = root.TryGetProperty("x", out var xEl) ? xEl.GetDouble() : 0;
    double y = root.TryGetProperty("y", out var yEl) ? yEl.GetDouble() : 0;

    if (!capture.TryMapNormalizedToScreen(x, y, out int sx, out int sy)) return;

    switch (action)
    {
        case "move":
            MouseInjector.Move(sx, sy);
            break;
        case "down":
            MouseInjector.Move(sx, sy);
            MouseInjector.LeftDown();
            break;
        case "up":
            MouseInjector.Move(sx, sy);
            MouseInjector.LeftUp();
            break;
        case "rightclick":
            MouseInjector.Move(sx, sy);
            MouseInjector.RightClick();
            break;
        default: // "click"
            MouseInjector.Move(sx, sy);
            MouseInjector.LeftClick();
            break;
    }
}

static double[] ReadDoubleArray(JsonElement parent, string name)
{
    if (!parent.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        return Array.Empty<double>();

    var list = new List<double>(arr.GetArrayLength());
    foreach (var el in arr.EnumerateArray())
        list.Add(el.ValueKind == JsonValueKind.Number ? el.GetDouble() : 0);
    return list.ToArray();
}

static Uri BuildWebSocketUri(string serverUrl, string path, string sessionId, string secret)
{
    var wsBase = serverUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
        ? "wss://" + serverUrl[8..]
        : serverUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase)
            ? "ws://" + serverUrl[7..]
            : serverUrl;

    var builder = new UriBuilder(new Uri(new Uri(wsBase), path));
    builder.Query = $"sessionId={Uri.EscapeDataString(sessionId)}&secret={Uri.EscapeDataString(secret)}";
    return builder.Uri;
}
