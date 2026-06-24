using System;
using System.Runtime.InteropServices;

namespace CaptureAgent;

// Inietta tasti della tastiera nel gioco. Usa SendInput con gli SCANCODE
// (non i virtual-key): è il modo più compatibile, perché molti giochi leggono
// la tastiera a basso livello (DirectInput/Raw Input) e ignorano gli eventi
// basati sul solo virtual-key.
//
// IMPORTANTE: la struttura INPUT deve avere la dimensione ESATTA che si aspetta
// Windows, altrimenti SendInput fallisce in silenzio e non inietta nulla. La
// union qui sotto include quindi anche MOUSEINPUT/HARDWAREINPUT (il membro più
// grande è quello del mouse): senza, su x64 la dimensione sarebbe 32 byte
// invece dei 40 richiesti, e nessun tasto verrebbe premuto.
public static class KeyboardInjector
{
    // Scancode "set 1" dei tasti che ci servono. Se il gioco usa tasti diversi
    // dai classici WASD/E, cambia questi valori (tabella: "scancodes set 1").
    public const ushort SC_W = 0x11;
    public const ushort SC_A = 0x1E;
    public const ushort SC_S = 0x1F;
    public const ushort SC_D = 0x20;
    public const ushort SC_E = 0x12;
    public const ushort SC_SPACE = 0x39;
    public const ushort SC_SHIFT = 0x2A;
    public const ushort SC_ESC = 0x01;

    public static void KeyDown(ushort scanCode) => Send(scanCode, keyUp: false);
    public static void KeyUp(ushort scanCode) => Send(scanCode, keyUp: true);

    public static void Tap(ushort scanCode)
    {
        Send(scanCode, keyUp: false);
        Send(scanCode, keyUp: true);
    }

    private static void Send(ushort scanCode, bool keyUp)
    {
        var input = new INPUT[1];
        input[0].type = INPUT_KEYBOARD;
        input[0].u.ki = new KEYBDINPUT
        {
            wVk = 0,
            wScan = scanCode,
            dwFlags = KEYEVENTF_SCANCODE | (keyUp ? KEYEVENTF_KEYUP : 0),
            time = 0,
            dwExtraInfo = IntPtr.Zero,
        };
        SendInput(1, input, Marshal.SizeOf<INPUT>());
    }

    // ── P/Invoke ────────────────────────────────────────────────────────────

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_SCANCODE = 0x0008;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    // La union deve contenere TUTTI i membri così che sizeof(INPUT) coincida con
    // quello di Windows (il mouse è il più grande).
    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
        [FieldOffset(0)] public HARDWAREINPUT hi;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HARDWAREINPUT
    {
        public uint uMsg;
        public ushort wParamL;
        public ushort wParamH;
    }
}
