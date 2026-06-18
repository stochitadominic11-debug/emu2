using System.Net.WebSockets;
using System.Text;

namespace CaptureAgent;

public sealed class StreamTransport : IAsyncDisposable
{
    private readonly Uri _uri;
    private ClientWebSocket? _ws;

    public StreamTransport(Uri uri)
    {
        _uri = uri;
    }

    public async Task ConnectAsync(CancellationToken ct)
    {
        _ws?.Dispose();
        _ws = new ClientWebSocket();
        await _ws.ConnectAsync(_uri, ct);
    }

    public async Task SendJsonAsync(string json, CancellationToken ct)
    {
        if (_ws is null || _ws.State != WebSocketState.Open) return;
        var bytes = Encoding.UTF8.GetBytes(json);
        await _ws.SendAsync(bytes, WebSocketMessageType.Text, true, ct);
    }

    public async Task SendBinaryAsync(byte[] payload, CancellationToken ct)
    {
        if (_ws is null || _ws.State != WebSocketState.Open) return;
        await _ws.SendAsync(payload, WebSocketMessageType.Binary, true, ct);
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
            catch { }

            _ws.Dispose();
            _ws = null;
        }
    }
}