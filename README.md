# RemotePlay — la tua libreria privata in VM (o sul PC)

Sito + agent per condividere i giochi con un amico da remoto: lui apre il
sito (anche dal browser della Xbox), clicca **Gioca**, e vede/controlla il
gioco come se girasse da lui.

## 0. Architettura, in breve

Tre pezzi, tutti sulla stessa macchina (VM o PC):

- **`server.js`** — il sito: libreria, login, e il centralino WebSocket che
  fa da ponte fra gli altri due pezzi.
- **`agent-win/agent.js`** (Node) — riceve il comando "lancia questo gioco",
  avvia l'`.exe`, e dopo un attimo avvia anche...
- **`agent-win/capture-agent/`** (C#, va compilato) — un programma nativo
  Windows che trova la finestra del gioco, la cattura con GDI
  (`CopyFromScreen`), la codifica in JPEG e la manda al sito via WebSocket.
  Riceve anche l'input del joystick e lo inietta con un Xbox 360 Controller
  virtuale (ViGEmBus), per chi gioca da remoto.

Il video passa come **JPEG via WebSocket**, non come un vero codec video: è
il metodo più semplice da far funzionare in casa, a costo di più banda/CPU
di un H.264 vero. I parametri di default (18fps, qualità 55, max 960px) sono
già pensati per restare leggeri; abbassali ancora in `agent-win/agent.js`
(`startCaptureAgent`) se serve.

## 1. Cosa serve prima di iniziare

- **Node.js 18+** sulla macchina che fa da host.
- **.NET 8 SDK** per compilare il capture-agent (`dotnet --version` per
  controllare se c'è già).
- **ViGEmBus**, *solo se vuoi il joystick virtuale*:
  https://github.com/ViGEm/ViGEmBus/releases (gratuito, lo stesso usato da
  Moonlight/Sunshine). Senza, il resto funziona comunque, semplicemente
  niente joystick remoto.
- Una cartella `C:\games` con dentro una sottocartella per ogni gioco, e
  dentro ogni sottocartella il suo `.exe`.
- **Se un gioco è un gioco Steam**: serve Steam installato e **già loggato
  e in esecuzione** sulla macchina, anche se lanci l'`.exe` copiato altrove.
  Molti giochi Steam controllano la presenza del processo Steam attivo, non
  solo i file — senza, possono dare errori come `RegOpenKeyExW failed`
  invece di partire.

## 2. Installazione

Nella cartella principale del progetto:

```bat
npm install
cd agent-win
npm install
cd capture-agent
dotnet publish -c Release
cd ..\..
```

Poi copia i file di esempio:

```bat
copy .env.example .env
copy agent-win\config.example.json agent-win\config.json
```

Apri **`.env`** e imposta almeno `SITE_PASSWORD` (la password che userete
tu e il tuo amico) e `GAMES_DIR` (di solito `C:\games`). `AGENT_SECRET` e
`agentSecret` in `config.json` devono restare identici fra loro — se usi
`avvia-tutto.bat` la prima volta, li genera e sincronizza da solo.

## 3. Avvio

Doppio clic su **`avvia-tutto.bat`**: alla prima esecuzione crea `.env` e
`config.json` da solo (mostra la password generata, scrivila da parte), poi
installa le dipendenze se manca `node_modules`, e infine apre le finestre di
Server e Agent (più una terza, Tunnel, se metti `cloudflared.exe` nella
stessa cartella — vedi sezione 7).

Apri `http://localhost:3000`, inserisci la password, dovresti vedere la
libreria.

## 4. La libreria

Niente da inserire a mano. Ogni sottocartella di `GAMES_DIR` con un `.exe`
dentro diventa una scheda automaticamente, con nome (dalla cartella, o da
un `game.json` opzionale tipo `{"name": "...", "args": "-flag"}`), copertina
(`cover.jpg`/`cover.png` nella cartella, o generata automaticamente), e il
pulsante **Gioca**. Scansione all'avvio e poi ogni `SCAN_INTERVAL_MS` (5
minuti di default). Una sessione alla volta.

## 5. Joystick (controller Xbox)

Il browser dell'amico legge il controller con la **Gamepad API** (la stessa
tecnologia di Xbox Cloud Gaming) e manda lo stato al server, che lo passa
all'agent, che lo inietta in un Xbox 360 Controller virtuale via ViGEmBus.
Mentre è visibile la schermata "Pronto a giocare?", premere un tasto
qualsiasi del controller equivale a cliccare "Inizia".

Se i movimenti risultano invertiti, guarda i commenti in
`agent-win/gamepad-bridge.js`.

### Controller per i giochi tastiera+mouse

Molti giochi **non** supportano affatto il joystick: si giocano con WASD +
mouse + tasti (es. premere **E** per interagire). Per questi, il controller
dell'amico viene tradotto in **tastiera + mouse** dal capture-agent
(`GamepadMapper.cs`), in parallelo al joystick virtuale qui sopra. Mappatura di
default:

- **Levetta sinistra / freccette → W A S D** (muoversi)
- **Levetta destra → mouse** (visuale; sensibilità regolabile, vedi sotto)
- **A / B / X / Y → E** (interagire / uscire dalla "bar" a inizio partita)
- **Menu/Option (☰, indice 9) → Esc** (apre il menu del gioco per uscire)
- **RT → click sinistro**, **LT → click destro**

⚠️ **Per i giochi tastiera+mouse, tieni SPENTO il joystick virtuale.** Metti
`"virtualGamepad": false` in `agent-win/config.json` (già così di default
nell'esempio). Se è acceso, il gioco "vede un controller collegato" e nei menu
il tasto B fa da *Indietro* (e il cursore mouse ruba la selezione), facendo
rimbalzare indietro la navigazione. Lascialo `true` solo per i giochi che
supportano davvero il joystick.

La **sensibilità della visuale** si regola dal sito (pulsante "⚙ Visuale" nella
pagina di gioco): lo slider viene salvato nel browser (`localStorage`), quindi
resta uguale a ogni rientro, e il valore viaggia dentro ogni messaggio di input
fino al `GamepadMapper`. Per cambiare i tasti, modifica `GamepadMapper.cs` (gli
scancode sono in `KeyboardInjector.cs`) e ricompila.

Perché i tasti arrivino al gioco, la sua finestra deve avere il **focus**: il
capture-agent prova a portarla in primo piano da solo, ma se il gioco gira come
amministratore e l'agent no, Windows blocca sia il focus sia l'iniezione → in
quel caso avvia l'agent come amministratore.

**Sicurezza — la cattura si ferma con il gioco.** Quando la finestra del gioco
si chiude, il capture-agent **esce del tutto**: non si riaggancia ad altre
finestre e non inietta più input. Così, finita la partita, l'amico non può
vedere il desktop né "smanettare" sul PC. È stato anche rimosso il vecchio
ripiego "aggancia la finestra più grande", che poteva mostrare finestre a caso
(desktop incluso) se non trovava il gioco. Effetto collaterale: se un gioco
**ricrea la sua finestra** (es. cambio risoluzione/fullscreen), la sessione si
chiude e va riavviata — un compromesso scelto a favore della sicurezza.

### Tocco/mouse da telefono

Oltre al joystick, chi gioca **da telefono** può usare il dito sullo schermo
come un mouse: toccare un punto del video clicca in quel punto esatto del
gioco, e trascinando si muove il cursore tenendo premuto. È pensato per i
giochi guidati col mouse (menù, party game come "Gamble With Your Friends");
i giochi che si controllano *solo* con la levetta analogica vogliono invece il
joystick virtuale qui sopra.

Tecnicamente: `play.js` manda al server le coordinate del tocco normalizzate
(0..1), il server le inoltra al **capture-agent C#**, che — conoscendo la
finestra del gioco — le trasforma nel pixel reale e inietta il click con le
API native di Windows (`MouseInjector.cs`). Se il gioco gira come
amministratore e il capture-agent no, Windows può bloccare l'iniezione: in
quel caso avvia anche l'agent come amministratore.

## 6. Audio

Il capture-agent C# oggi cattura solo video. Aggiungere l'audio di sistema
è un passo successivo non ancora implementato in questa versione.

## 7. Accesso da reti diverse

Tailscale da solo non basta: su Xbox non si può installare nessun client di
terze parti. La soluzione più semplice è **Cloudflare Tunnel**:

1. Scarica `cloudflared-windows-amd64.exe` da
   https://github.com/cloudflare/cloudflared/releases/latest, rinominalo
   `cloudflared.exe`, e mettilo nella cartella principale del progetto
   (stessa cartella di `avvia-tutto.bat`).
2. Rilancia `avvia-tutto.bat`: si apre anche una finestra "Tunnel" con un
   link tipo `https://parole-a-caso.trycloudflare.com` — quello è il link
   da dare al tuo amico al posto dell'IP locale.
3. Cambia ogni volta che riavvii (è il prezzo della versione gratuita senza
   account Cloudflare). La password del sito resta comunque attiva.

## 8. Prestazioni: cosa fare se va a scatti

Due problemi diversi, da non confondere:

- **Lo stream verso l'amico è lento/a scatti**: prova ad abbassare ancora
  `targetFps`/`jpegQuality`/`maxDimension` in `agent-win/agent.js`, e
  confronta giocando in LAN (IP locale) contro il link Cloudflare — se in
  LAN è molto più fluido, il tunnel è il collo di bottiglia principale.

- **Il gioco stesso va a scatti dentro la VM**, indipendentemente dallo
  streaming: questo è un limite della VM, non del nostro sito. **VMware
  Workstation non supporta il passthrough vero della GPU** — la spunta
  "Accelerate 3D graphics" è già il massimo che può dare, adeguato per
  giochi leggeri ma non per titoli 3D pesanti. Non esiste un'altra
  impostazione da attivare. Le uniche strade reali: abbassare la grafica
  del gioco al minimo, oppure far girare tutto direttamente sul PC fisico
  invece che in VM (massime prestazioni, ma il PC resta "occupato" mentre
  si gioca). GPU-P di Hyper-V **non è un'alternativa**: richiede Windows
  Server 2025+, non funziona su Windows 10/11 Pro.

## 9. Cosa è stato testato davvero

Lo sviluppo di questo progetto è avvenuto senza accesso diretto a una VM
Windows con schermo/controller reali. Sono stati testati end-to-end (server
e agent veri, non simulati): lo scanner della libreria, login e protezione
delle pagine/API, il relay WebSocket completo capture-agent↔server↔viewer↔
agent, la gestione robusta degli errori (exe non trovato, spawn fallito,
ViGEmBus assente). La cattura schermo reale, l'iniezione nel controller
virtuale, e le prestazioni effettive dipendono dalla macchina su cui girano
— qualunque comportamento strano vada verificato lì.

## Struttura del progetto

```
remote-play-web/
  server.js                 sito + centralino WebSocket
  lib/                       scanner, db, sessioni, autenticazione
  public/                    pagine del sito (libreria, login, gioca)
  agent-win/
    agent.js                 avvia i giochi, fa da ponte per il joystick
    gamepad-bridge.js         Gamepad API -> Xbox 360 virtuale (ViGEmBus)
    capture-agent/            programma C# che cattura schermo e manda video
  data/db.json                "database" locale (creato da solo)
  avvia-tutto.bat              avvia tutto con un doppio clic
  setup-helper.ps1              configurazione automatica al primo avvio
```
