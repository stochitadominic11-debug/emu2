using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

namespace CaptureAgent;

public sealed class WindowCaptureService
{
    private IntPtr _hwnd = IntPtr.Zero;

    public int AttachedProcessId { get; private set; }

    // Processi che NON sono mai il gioco: la nostra stessa interfaccia
    // (finestre cmd dell'agent/server), la shell di Windows, il browser
    // con cui si guarda il sito. Usati solo nell'ultimo livello di ricerca
    // ("finestra più grande sullo schermo"), per non rubare per sbaglio
    // quella finestra lì invece del gioco.
    private static readonly HashSet<string> Blocklist = new(StringComparer.OrdinalIgnoreCase)
    {
        "explorer", "cmd", "powershell", "pwsh", "windowsterminal",
        "applicationframehost", "textinputhost", "systemsettings",
        "screenclippinghost", "shellexperiencehost", "searchhost",
        "startmenuexperiencehost", "dotnet", "captureagent", "node",
        "chrome", "msedge", "firefox", "brave", "opera",
    };

    private record Candidate(IntPtr Hwnd, uint Pid, string ProcessName, string Title, int Width, int Height);

    // Process.ProcessName di .NET non include mai ".exe"; il nome che ci
    // arriva da config invece a volte sì. Normalizziamo entrambi i lati
    // prima di confrontarli, così il livello 1 (match esatto) funziona
    // davvero invece di fallire sempre e scaricare tutto sul livello 2.
    private static string NormalizeProcessName(string name) =>
        name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? name[..^4] : name;

    private static List<Candidate> EnumerateCandidates()
    {
        var list = new List<Candidate>();

        EnumWindows((hWnd, _) =>
        {
            if (!IsWindowVisible(hWnd)) return true;
            if (GetParent(hWnd) != IntPtr.Zero) return true; // solo finestre top-level
            if (!GetWindowRect(hWnd, out var r)) return true;

            int w = r.Right - r.Left;
            int h = r.Bottom - r.Top;
            if (w < 100 || h < 100) return true; // niente popup/splash minuscoli

            GetWindowThreadProcessId(hWnd, out uint pid);

            string procName = "";
            try { procName = Process.GetProcessById((int)pid).ProcessName; }
            catch { /* il processo potrebbe essere già chiuso, lo saltiamo */ return true; }

            string title = GetWindowTitle(hWnd);

            list.Add(new Candidate(hWnd, pid, procName, title, w, h));
            return true;
        }, IntPtr.Zero);

        return list;
    }

    private static string GetWindowTitle(IntPtr hWnd)
    {
        int len = GetWindowTextLength(hWnd);
        if (len == 0) return "";
        var sb = new StringBuilder(len + 1);
        GetWindowText(hWnd, sb, sb.Capacity);
        return sb.ToString();
    }

    // Punto d'ingresso principale: prova più strategie in ordine, dalla più
    // precisa alla più generica, finché una trova qualcosa.
    // allowLargestWindowFallback va messo a true solo dopo aver già aspettato
    // un po': altrimenti il livello 4 rischia di agganciarsi a una finestra
    // già aperta prima ancora che il gioco sia partito.
    public bool TryFindAndAttach(string processNameHint, bool allowLargestWindowFallback)
    {
        var candidates = EnumerateCandidates();
        if (candidates.Count == 0) return false;

        string normalizedHint = NormalizeProcessName(processNameHint);

        // 1) nome processo identico (case-insensitive, ignorando ".exe")
        var match = FindBest(candidates, c => c.ProcessName.Equals(normalizedHint, StringComparison.OrdinalIgnoreCase));
        // 2) nome processo che CONTIENE il nome cercato (o viceversa)
        match ??= FindBest(candidates, c =>
            c.ProcessName.Contains(normalizedHint, StringComparison.OrdinalIgnoreCase) ||
            normalizedHint.Contains(c.ProcessName, StringComparison.OrdinalIgnoreCase));
        // 3) titolo della finestra che contiene il nome del gioco
        match ??= FindBest(candidates, c => c.Title.Contains(normalizedHint, StringComparison.OrdinalIgnoreCase));
        // 4) ultima spiaggia: la finestra visibile più grande, escludendo le finestre "di sistema"
        if (match is null && allowLargestWindowFallback)
            match = FindBest(candidates, c => !Blocklist.Contains(c.ProcessName));

        if (match is null) return false;

        _hwnd = match.Hwnd;
        AttachedProcessId = (int)match.Pid;
        Console.WriteLine(
            $"[capture] finestra agganciata: processo='{match.ProcessName}' (PID {match.Pid}), " +
            $"titolo=\"{match.Title}\", {match.Width}x{match.Height} px");
        return true;
    }

    private static Candidate? FindBest(List<Candidate> candidates, Func<Candidate, bool> predicate)
    {
        Candidate? best = null;
        foreach (var c in candidates)
        {
            if (!predicate(c)) continue;
            if (best is null || c.Width * c.Height > best.Width * best.Height) best = c;
        }
        return best;
    }

    public bool IsAttachedWindowStillOpen() => _hwnd != IntPtr.Zero && IsWindow(_hwnd);

    // Converte un punto "normalizzato" (0..1, 0..1) ricevuto dal viewer — dove
    // (0,0) è l'angolo in alto a sinistra dell'immagine mostrata e (1,1) quello
    // in basso a destra — nelle coordinate schermo reali della finestra agganciata.
    // Il frame inviato copre tutta la finestra (GetWindowRect), quindi la stessa
    // proporzione vale sia per il viewer sia per lo schermo.
    public bool TryMapNormalizedToScreen(double nx, double ny, out int screenX, out int screenY)
    {
        screenX = 0;
        screenY = 0;
        if (_hwnd == IntPtr.Zero) return false;
        if (!GetWindowRect(_hwnd, out var r)) return false;

        nx = Math.Clamp(nx, 0.0, 1.0);
        ny = Math.Clamp(ny, 0.0, 1.0);
        screenX = r.Left + (int)Math.Round(nx * (r.Right - r.Left));
        screenY = r.Top + (int)Math.Round(ny * (r.Bottom - r.Top));
        return true;
    }

    private DateTime _lastForeground = DateTime.MinValue;

    // Porta in primo piano la finestra del gioco, così tastiera/mouse iniettati
    // arrivano davvero a lui e non a un'altra finestra. Lo facciamo al massimo
    // una volta al secondo e solo se non è già in primo piano, per non rubargli
    // il focus di continuo. Best-effort: Windows a volte blocca il cambio di
    // focus da un processo in background, ma di solito il gioco è già davanti.
    public void EnsureForeground()
    {
        if (_hwnd == IntPtr.Zero) return;
        var now = DateTime.UtcNow;
        if ((now - _lastForeground).TotalMilliseconds < 1000) return;
        _lastForeground = now;
        if (GetForegroundWindow() == _hwnd) return;
        SetForegroundWindow(_hwnd);
    }

    private bool _printWindowFailed = false; // una volta fallito, non lo riproviamo ogni frame

    public CaptureFrame? CaptureFrameJpeg(int jpegQuality, int maxDimension)
    {
        if (_hwnd == IntPtr.Zero) return null;
        if (!GetWindowRect(_hwnd, out var r)) return null;

        int width = r.Right - r.Left;
        int height = r.Bottom - r.Top;
        if (width <= 1 || height <= 1) return null;

        width = Math.Min(width, 4096);
        height = Math.Min(height, 4096);

        try
        {
            Bitmap? bmp = null;

            if (!_printWindowFailed)
            {
                bmp = CapturePrintWindow(width, height);
                if (bmp is null)
                {
                    _printWindowFailed = true;
                    Console.WriteLine(
                        "[capture] PrintWindow non ha funzionato per questo gioco (immagine nera/vuota) " +
                        "-> torno a CopyFromScreen: il gioco deve restare visibile sullo schermo.");
                }
                else
                {
                    Console.WriteLine("[capture] PrintWindow funziona: il gioco può restare in background.");
                }
            }

            bmp ??= CaptureViaCopyFromScreen(r.Left, r.Top, width, height);
            if (bmp is null) return null;

            using (bmp)
            {
                if (maxDimension > 0 && (width > maxDimension || height > maxDimension))
                {
                    double scale = Math.Min((double)maxDimension / width, (double)maxDimension / height);
                    int sw = Math.Max(1, (int)(width * scale));
                    int sh = Math.Max(1, (int)(height * scale));

                    using var scaled = new Bitmap(sw, sh);
                    using (var sg = Graphics.FromImage(scaled))
                    {
                        sg.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.Bilinear;
                        sg.DrawImage(bmp, 0, 0, sw, sh);
                    }
                    return EncodeJpeg(scaled, jpegQuality);
                }

                return EncodeJpeg(bmp, jpegQuality);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[capture] cattura fallita: {ex.Message}");
            return null;
        }
    }

    private static Bitmap CaptureViaCopyFromScreen(int left, int top, int width, int height)
    {
        var bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.CopyFromScreen(left, top, 0, 0, new Size(width, height), CopyPixelOperation.SourceCopy);
        }
        return bmp;
    }

    // Chiede DIRETTAMENTE alla finestra di disegnarsi in un bitmap, invece di
    // fotografare lo schermo: PW_RENDERFULLCONTENT (Windows 8.1+) a volte
    // riesce anche con contenuto accelerato dalla GPU e finestre non in primo
    // piano. Con molti giochi 3D però non funziona e produce un'immagine
    // nera: per questo controlliamo il risultato prima di fidarci.
    private const uint PW_RENDERFULLCONTENT = 0x00000002;

    private Bitmap? CapturePrintWindow(int width, int height)
    {
        IntPtr screenDc = GetDC(IntPtr.Zero);
        IntPtr memDc = IntPtr.Zero;
        IntPtr hBitmap = IntPtr.Zero;
        IntPtr oldObj = IntPtr.Zero;

        try
        {
            if (screenDc == IntPtr.Zero) return null;

            memDc = CreateCompatibleDC(screenDc);
            hBitmap = CreateCompatibleBitmap(screenDc, width, height);
            if (memDc == IntPtr.Zero || hBitmap == IntPtr.Zero) return null;

            oldObj = SelectObject(memDc, hBitmap);

            bool ok = PrintWindow(_hwnd, memDc, PW_RENDERFULLCONTENT);
            if (!ok) return null;

            using var temp = Image.FromHbitmap(hBitmap);
            if (IsLikelyBlank(temp)) return null;

            return new Bitmap(temp); // copia gestita, indipendente dall'HBITMAP nativo
        }
        catch
        {
            return null;
        }
        finally
        {
            if (memDc != IntPtr.Zero && oldObj != IntPtr.Zero) SelectObject(memDc, oldObj);
            if (hBitmap != IntPtr.Zero) DeleteObject(hBitmap);
            if (memDc != IntPtr.Zero) DeleteDC(memDc);
            if (screenDc != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    // Controllo economico: campiona una manciata di pixel sparsi invece di
    // scandire tutta l'immagine, per capire se PrintWindow ha prodotto
    // qualcosa di vero o solo un rettangolo nero (il fallimento tipico con
    // rendering 3D che PrintWindow non riesce a leggere).
    private static bool IsLikelyBlank(Image image)
    {
        using var bmp = new Bitmap(image);
        const int samples = 16;
        for (int i = 0; i < samples; i++)
        {
            int x = Math.Clamp((bmp.Width * i) / samples, 0, bmp.Width - 1);
            int y = Math.Clamp((bmp.Height * ((i * 7) % samples)) / samples, 0, bmp.Height - 1);
            var px = bmp.GetPixel(x, y);
            if (px.R > 12 || px.G > 12 || px.B > 12) return false;
        }
        return true;
    }

    private static CaptureFrame EncodeJpeg(Bitmap bmp, int quality)
    {
        using var ms = new MemoryStream();
        var enc = ImageCodecInfo.GetImageEncoders().First(x => x.FormatID == ImageFormat.Jpeg.Guid);
        var parms = new EncoderParameters(1);
        parms.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)quality);
        bmp.Save(ms, enc, parms);
        return new CaptureFrame(ms.ToArray(), bmp.Width, bmp.Height, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    // ── P/Invoke ────────────────────────────────────────────────────────────

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int width, int height);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }
}