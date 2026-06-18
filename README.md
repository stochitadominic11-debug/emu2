# RemotePlay

Sito + agent per condividere i giochi della VM con un amico da browser.
Il gioco gira nella VM, il tuo amico vede lo stream e manda input controller.

## Requisiti

- Node.js 18+ nella VM.
- ViGEmBus nella VM se vuoi il controller virtuale.
- Una cartella giochi, di default `C:\games`.

## Setup

Dentro la cartella progetto:

```bat
npm install
cd agent-win
npm install
cd ..
copy .env.example .env
copy agent-win\config.example.json agent-win\config.json
```

Configura:

- `.env`: `SITE_PASSWORD`, `AGENT_SECRET`, `GAMES_DIR`.
- `agent-win\config.json`: stesso `AGENT_SECRET` in `agentSecret`.

## Avvio

```bat
avvia-tutto.bat
```

Oppure a mano:

```bat
node server.js
cd agent-win
node agent.js config.json
```

## Libreria

Ogni sottocartella di `GAMES_DIR` con un `.exe` diventa una scheda gioco.

Esempio:

```text
C:\games
  NomeGioco
    game.exe
    cover.jpg
    game.json
```

`game.json` opzionale:

```json
{
  "name": "Nome Vero",
  "args": "-windowed"
}
```

## Come si gioca

1. Tu e il tuo amico aprite il sito e fate login.
2. Il tuo amico clicca `Gioca`.
3. L'agent avvia l'exe nella VM.
4. L'agent apre Edge su `capture.html`.
5. Edge prova ad avviare la cattura automaticamente.
6. Se Edge non autoseleziona la sorgente, clicca `Condividi schermo` e scegli `Intero schermo`.
7. Il tuo amico vede lo stream nella pagina `Gioca` e controlla il controller.

## Cattura automatica

Una pagina web non puo catturare lo schermo in modo garantito senza consenso.
`getDisplayMedia()` e progettato per mostrare una scelta all'utente.

L'agent prova comunque ad aprire Edge con:

```text
--auto-select-desktop-capture-source="Entire screen"
```

Puoi cambiare il nome in:

```json
{
  "autoCaptureSource": "Entire screen"
}
```

Se vuoi automatico al 100%, serve un agent nativo Windows con Windows Graphics Capture + encoder video/audio.

## FPS

Il target e 60 FPS:

- capture chiede `frameRate: 60`;
- il loop video usa circa 16 ms;
- il viewer invia input ogni 16 ms.

Questa versione usa JPEG via WebSocket. Se CPU/rete non reggono, salta frame per non accumulare lag.
Per 60 FPS stabili veri serve H.264/Opus + WebRTC, oppure Sunshine/Moonlight.

## Audio

Per ricevere audio devi condividere `Intero schermo` e abilitare audio di sistema nel popup del browser.
Il viewer usa MediaSource per riprodurre i chunk `audio/webm; codecs=opus`.

## Controller

Il viewer legge il controller con Gamepad API e manda lo stato all'agent.
L'agent usa ViGEmBus per creare un controller virtuale Xbox 360.

Il bug `Cannot read properties of undefined (reading 'setValue')` era causato da nomi pulsante sbagliati.
Ora i nomi usati sono quelli reali di `vigemclient`: `LEFT_SHOULDER`, `START`, `DPAD`, ecc.

## Accesso da reti diverse

Per Xbox fuori rete locale puoi usare Cloudflare Tunnel:

```bat
cloudflared.exe tunnel --url http://localhost:3000
```

Il link `trycloudflare.com` funziona dal browser Xbox, senza installare client sulla console.
