using System.IO;
using System.Net.WebSockets;
using System.Text;

namespace CaptureAgent;

// Wrapper sottile su ClientWebSocket: connessione, invio testo (JSON) e
// invio binario (frame video/audio), con chiusura pulita a fine vita.
public sealed class StreamTransport : IAsyncDisposable
{
    private readonly Uri _uri;
    private ClientWebSocket? _ws;

    public StreamTransport(Uri uri)
    {
        _uri = uri;
    }

    // Espone il socket corrente così chi riceve i messaggi può "agganciarlo"
    // una volta sola: dopo una riconnessione il socket cambia, e il vecchio
    // loop di ricezione termina da solo invece di rubare i dati al nuovo.
    public ClientWebSocket? CurrentSocket => _ws;

    public async Task ConnectAsync(CancellationToken ct)
    {
        _ws?.Dispose();
        _ws = new ClientWebSocket();
        await _ws.ConnectAsync(_uri, ct);
    }

    // Legge un messaggio di testo (JSON) da uno specifico socket. Statico e con
    // il socket passato come parametro di proposito: vedi CurrentSocket sopra.
    public static async Task<string?> ReceiveTextAsync(ClientWebSocket ws, CancellationToken ct)
    {
        var buffer = new byte[8192];
        using var ms = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await ws.ReceiveAsync(buffer, ct);
            if (result.MessageType == WebSocketMessageType.Close) return null;
            ms.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);

        return Encoding.UTF8.GetString(ms.GetBuffer(), 0, (int)ms.Length);
    }

    public async Task SendJsonAsync(string json, CancellationToken ct)
    {
        if (_ws is null || _ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    public async Task SendBinaryAsync(byte[] data, CancellationToken ct)
    {
        if (_ws is null || _ws.State != WebSocketState.Open) return;
        await _ws.SendAsync(data, WebSocketMessageType.Binary, true, ct);
    }

    public async ValueTask DisposeAsync()
    {
        if (_ws is not null)
        {
            try
            {
                if (_ws.State == WebSocketState.Open)
                    await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None);
            }
            catch
            {
                /* la connessione potrebbe essere già caduta, non importa in chiusura */
            }
            _ws.Dispose();
        }
    }
}
