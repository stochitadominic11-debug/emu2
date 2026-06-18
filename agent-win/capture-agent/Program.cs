using System.Text.Json;
using CaptureAgent;

if (!OperatingSystem.IsWindows())
{
    Console.Error.WriteLine("Questo capture-agent funziona solo su Windows.");
    return;
}

var cfg = AppConfigLoader.Load(args);
var locator = new ProcessLocator();
var capture = new WindowCaptureService();
var encoder = new FrameEncoder();

var wsUri = BuildWebSocketUri(cfg.ServerUrl, "/ws/capture-agent", cfg.SessionId, cfg.AgentSecret);
await using var transport = new StreamTransport(wsUri);

var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

while (!cts.IsCancellationRequested)
{
    try
    {
        await transport.ConnectAsync(cts.Token);
        await transport.SendJsonAsync(JsonSerializer.Serialize(new AgentStatus("started", "capture agent online")), cts.Token);

        Console.WriteLine($"[capture] in ascolto del processo: {cfg.ProcessName}");
        var process = locator.WaitForProcess(cfg.ProcessName, cts.Token);
        if (process is null)
            break;

        Console.WriteLine($"[capture] trovato PID {process.Id}");

        if (!capture.AttachToProcess(process))
        {
            await transport.SendJsonAsync(
                JsonSerializer.Serialize(new AgentStatus("error", "main window non trovata", process.Id)),
                cts.Token
            );
            await Task.Delay(cfg.ReconnectDelayMs, cts.Token);
            continue;
        }

        await transport.SendJsonAsync(
            JsonSerializer.Serialize(new AgentStatus("attached", "window attached", process.Id)),
            cts.Token
        );

        var delay = TimeSpan.FromMilliseconds(Math.Max(1, 1000.0 / Math.Max(1, cfg.TargetFps)));

        while (!cts.IsCancellationRequested && !process.HasExited)
        {
            var frame = capture.CaptureFrameJpeg(cfg.JpegQuality, cfg.MaxDimension);
            if (frame is not null)
            {
                var payload = encoder.PackVideoFrame(frame);
                await transport.SendBinaryAsync(payload, cts.Token);
            }

            await Task.Delay(delay, cts.Token);
        }

        await transport.SendJsonAsync(
            JsonSerializer.Serialize(new AgentStatus("ended", "process exited", process.Id)),
            cts.Token
        );

        await Task.Delay(cfg.ReconnectDelayMs, cts.Token);
    }
    catch (OperationCanceledException)
    {
        break;
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[capture] errore: {ex.Message}");
        try
        {
            await transport.SendJsonAsync(JsonSerializer.Serialize(new AgentStatus("error", ex.Message)), CancellationToken.None);
        }
        catch
        {
        }

        await Task.Delay(cfg.ReconnectDelayMs, cts.Token);
    }
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