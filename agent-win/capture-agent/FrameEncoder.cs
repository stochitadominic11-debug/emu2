namespace CaptureAgent;

public sealed class FrameEncoder
{
    public byte[] PackVideoFrame(CaptureFrame frame)
    {
        // Protocollo compatibile con il tuo viewer:
        // byte 0 = 1 => frame video JPEG
        var payload = new byte[1 + frame.JpegBytes.Length];
        payload[0] = 1;
        Buffer.BlockCopy(frame.JpegBytes, 0, payload, 1, frame.JpegBytes.Length);
        return payload;
    }
}