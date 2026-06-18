using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace CaptureAgent;

public sealed class WindowCaptureService
{
    private IntPtr _hwnd = IntPtr.Zero;

    public bool AttachToProcess(System.Diagnostics.Process process)
    {
        process.Refresh();
        _hwnd = process.MainWindowHandle;

        return _hwnd != IntPtr.Zero;
    }

    public CaptureFrame? CaptureFrameJpeg(int jpegQuality, int maxDimension)
    {
        if (_hwnd == IntPtr.Zero)
            return null;

        if (!IsWindowVisible(_hwnd))
            return null;

        var rect = GetWindowRectSafe(_hwnd);

        int width = Math.Max(1, rect.Width);
        int height = Math.Max(1, rect.Height);

        using var bmp = new Bitmap(width, height);

        using (var g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(
                rect.Left,
                rect.Top,
                0,
                0,
                new Size(width, height),
                CopyPixelOperation.SourceCopy
            );
        }

        return EncodeJpeg(bmp, jpegQuality);
    }

    private static CaptureFrame EncodeJpeg(Bitmap bitmap, int quality)
    {
        using var ms = new MemoryStream();

        var encoder = ImageCodecInfo.GetImageEncoders()
            .First(x => x.FormatID == ImageFormat.Jpeg.Guid);

        var encParams = new EncoderParameters(1);

        encParams.Param[0] =
            new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, quality);

        bitmap.Save(ms, encoder, encParams);

        return new CaptureFrame(
            ms.ToArray(),
            bitmap.Width,
            bitmap.Height,
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        );
    }

    private static Rectangle GetWindowRectSafe(IntPtr hwnd)
    {
        if (!GetWindowRect(hwnd, out var rect))
            return Rectangle.Empty;

        return Rectangle.FromLTRB(
            rect.Left,
            rect.Top,
            rect.Right,
            rect.Bottom
        );
    }

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(
        IntPtr hWnd,
        out RECT lpRect
    );

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(
        IntPtr hWnd
    );

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}