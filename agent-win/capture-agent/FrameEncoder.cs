namespace CaptureAgent;

public sealed class FrameEncoder
{
    public byte[] PackVideoFrame(CaptureFrame frame)
    {
        // Protocollo binario condiviso col viewer (public/play.js):
        // byte 0 = 1 => frame video JPEG, dal byte 1 in poi i dati JPEG veri.
        var payload = new byte[1 + frame.JpegBytes.Length];
        payload[0] = 1;
        Buffer.BlockCopy(frame.JpegBytes, 0, payload, 1, frame.JpegBytes.Length);
        return payload;
    }
}
