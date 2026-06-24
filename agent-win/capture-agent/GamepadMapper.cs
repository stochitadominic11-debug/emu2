using System;
using System.Collections.Generic;

namespace CaptureAgent;

// Traduce lo stato del controller (letto dal browser dell'amico e inoltrato dal
// server) in TASTIERA + MOUSE, per i giochi che NON supportano il joystick ma
// si giocano con WASD + mouse + tasto E.
//
// Mappatura attuale — cambiala qui se il gioco usa comandi diversi:
//   Levetta SINISTRA / freccette  -> W A S D            (muoversi)
//   Levetta DESTRA                -> movimento del mouse (visuale)
//   A / B / X / Y (tasto frontale) -> E                  (interagire / uscire dalla bar)
//   Grilletto destro (RT)         -> click sinistro      (usare/sparare)
//   Grilletto sinistro (LT)       -> click destro
//
// Riceve gli array così come arrivano dalla Gamepad API del browser:
//   axes:    [levSx_X, levSx_Y, levDx_X, levDx_Y]  ognuno da -1 a 1
//   buttons: 0=A 1=B 2=X 3=Y 4=LB 5=RB 6=LT 7=RT 8=Back 9=Start
//            10=LS 11=RS 12=su 13=giù 14=sx 15=dx   (0 = rilasciato, 1 = premuto)
public sealed class GamepadMapper
{
    private const double MoveThreshold = 0.5;    // oltre quanto la levetta "preme" il tasto WASD
    private const double LookDeadzone = 0.15;    // sotto questo la levetta destra è considerata ferma

    // Sensibilità della visuale: pixel di mouse per frame a fondo corsa.
    // Non è più costante: il sito la regola con lo slider (la manda dentro ogni
    // messaggio di input). 30 è un default "medio", più reattivo del vecchio 14.
    private double _lookSensitivity = 30.0;

    public void SetLookSensitivity(double value)
    {
        // limiti di sicurezza: né ferma né impazzita.
        _lookSensitivity = Math.Clamp(value, 1.0, 200.0);
    }

    private readonly Dictionary<ushort, bool> _keyDown = new();
    private bool _prevFace = false; // A/B/X/Y come gruppo, per fare UN tap di E a ogni pressione
    private bool _prevMenu = false; // tasto Menu/Option, per un tap di Esc a ogni pressione
    private bool _prevRt = false;
    private bool _prevLt = false;

    public void Apply(double[] axes, double[] buttons)
    {
        double lx = axes.Length > 0 ? axes[0] : 0;
        double ly = axes.Length > 1 ? axes[1] : 0;
        double rx = axes.Length > 2 ? axes[2] : 0;
        double ry = axes.Length > 3 ? axes[3] : 0;

        bool Btn(int i) => buttons.Length > i && buttons[i] > 0.5;

        // --- movimento: levetta sinistra + freccette -> WASD ---
        // Nota: nella Gamepad API "su" sull'asse Y è NEGATIVO.
        SetKey(KeyboardInjector.SC_W, ly < -MoveThreshold || Btn(12));
        SetKey(KeyboardInjector.SC_S, ly > MoveThreshold || Btn(13));
        SetKey(KeyboardInjector.SC_A, lx < -MoveThreshold || Btn(14));
        SetKey(KeyboardInjector.SC_D, lx > MoveThreshold || Btn(15));

        // --- visuale: levetta destra -> movimento relativo del mouse ---
        if (Math.Sqrt(rx * rx + ry * ry) > LookDeadzone)
        {
            int dx = (int)Math.Round(rx * _lookSensitivity);
            int dy = (int)Math.Round(ry * _lookSensitivity);
            if (dx != 0 || dy != 0) MouseInjector.MoveRelative(dx, dy);
        }

        // --- E: qualsiasi tasto frontale (A/B/X/Y), un tap a ogni pressione ---
        bool face = Btn(0) || Btn(1) || Btn(2) || Btn(3);
        if (face && !_prevFace) KeyboardInjector.Tap(KeyboardInjector.SC_E);
        _prevFace = face;

        // --- Menu/Option (☰, indice 9) -> Esc: apre il menu del gioco per uscire ---
        bool menu = Btn(9);
        if (menu && !_prevMenu) KeyboardInjector.Tap(KeyboardInjector.SC_ESC);
        _prevMenu = menu;

        // --- grilletti -> click del mouse (tieni premuto finché tieni il grilletto) ---
        bool rt = Btn(7);
        if (rt && !_prevRt) MouseInjector.LeftDown();
        else if (!rt && _prevRt) MouseInjector.LeftUp();
        _prevRt = rt;

        bool lt = Btn(6);
        if (lt && !_prevLt) MouseInjector.RightDown();
        else if (!lt && _prevLt) MouseInjector.RightUp();
        _prevLt = lt;
    }

    // Rilascia tutto: utile se l'amico si disconnette mentre teneva premuto,
    // così il gioco non resta con un tasto "incollato".
    public void ReleaseAll()
    {
        foreach (var scan in new List<ushort>(_keyDown.Keys)) SetKey(scan, false);
        if (_prevRt) { MouseInjector.LeftUp(); _prevRt = false; }
        if (_prevLt) { MouseInjector.RightUp(); _prevLt = false; }
        _prevFace = false;
        _prevMenu = false;
    }

    private void SetKey(ushort scanCode, bool wantDown)
    {
        bool isDown = _keyDown.TryGetValue(scanCode, out var d) && d;
        if (wantDown && !isDown)
        {
            KeyboardInjector.KeyDown(scanCode);
            _keyDown[scanCode] = true;
        }
        else if (!wantDown && isDown)
        {
            KeyboardInjector.KeyUp(scanCode);
            _keyDown[scanCode] = false;
        }
    }
}
