using System;
using System.Runtime.InteropServices;

namespace CaptureAgent;

// Inietta input del mouse nel sistema, così un tocco sul telefono dell'amico
// diventa un click reale dentro il gioco. Usa le API native di Windows
// (SetCursorPos + mouse_event): il capture-agent gira nella stessa sessione
// desktop del gioco, quindi può muovere il cursore e cliccare per davvero.
//
// NOTA: se il gioco gira come amministratore e il capture-agent no, Windows
// (UIPI) può bloccare l'iniezione. In quel caso avvia anche questo agent
// come amministratore. La maggior parte dei giochi però non è elevata.
public static class MouseInjector
{
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    private const uint MOUSEEVENTF_MOVE = 0x0001;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;

    public static void Move(int x, int y) => SetCursorPos(x, y);

    // Movimento RELATIVO del mouse: serve per la visuale dei giochi (la levetta
    // destra muove la telecamera). dx/dy possono essere negativi.
    public static void MoveRelative(int dx, int dy) =>
        mouse_event(MOUSEEVENTF_MOVE, unchecked((uint)dx), unchecked((uint)dy), 0, UIntPtr.Zero);

    public static void LeftDown() => mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);

    public static void LeftUp() => mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);

    public static void LeftClick()
    {
        LeftDown();
        LeftUp();
    }

    public static void RightDown() => mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);

    public static void RightUp() => mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);

    public static void RightClick()
    {
        RightDown();
        RightUp();
    }
}
