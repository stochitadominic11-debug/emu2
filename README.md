# RemotePlay — la tua libreria privata in VM

Sito + agent per condividere i giochi della tua VM con un amico da remoto:
lui apre il sito (anche dal browser della Xbox), clicca **Gioca**, e vede/controlla
il gioco come se girasse da lui.

> Questa è una **ricostruzione da zero**, non una patch del progetto precedente:
> non avevo accesso ai file reali, quindi ho riscritto tutto da capo basandomi su
> come avevi descritto che doveva funzionare. Sostituisce completamente la vecchia
> versione (server.js, public/app.js, agent-win, ecc.).

## 0. Cosa serve prima di iniziare

- **Node.js 18+** installato dentro la VM ([nodejs.org](https://nodejs.org))
- **ViGEmBus** installato dentro la VM, *solo se vuoi il joystick virtuale*:
  https://github.com/ViGEm/ViGEmBus/releases (driver gratuito, lo stesso usato da
  Moonlight/Sunshine). Senza, il resto funziona comunque, semplicemente niente joystick.
- Una cartella `C:\games` con dentro una sottocartella per ogni gioco, e dentro
  ogni sottocartella il suo `.exe`.

## 1. Installazione

Dentro la VM, nella cartella del progetto:

```bat
npm install
cd agent-win
npm install
cd ..
```

Poi copia i file di esempio e modificali:

```bat
copy .env.example .env
copy agent-win\config.example.json agent-win\config.json
```

Apri **`.env`** e imposta almeno:
- `SITE_PASSWORD` — la password che userete tu e il tuo amico per entrare nel sito
- `AGENT_SECRET` — una stringa a caso, deve essere **identica** a `agentSecret` in `agent-win\config.json`
- `GAMES_DIR` — di solito va bene `C:\games`

## 2. Avvio

Doppio clic su **`avvia-tutto.bat`**: apre da solo la finestra del server e quella
dell'agent, in ordine giusto. Lasciale aperte mentre giocate.

(In alternativa, a mano: `node server.js` in una finestra, `node agent.js config.json`
dentro `agent-win` in un'altra.)

Apri `http://localhost:3000` (o l'IP della VM), inserisci `SITE_PASSWORD` e dovresti
vedere la libreria.

## 3. La libreria

Niente da inserire a mano. Ogni sottocartella di `GAMES_DIR` con un `.exe` dentro
diventa una scheda, con:
- **nome**: dal nome della cartella (o da un file `game.json` opzionale tipo
  `{"name": "Nome Vero", "args": "-flag"}` dentro la cartella, se vuoi personalizzarlo)
- **copertina**: usa `cover.jpg`/`cover.png` se la metti nella cartella, altrimenti
  ne genera una semplice automaticamente
- **pulsante Gioca**

La scansione avviene all'avvio e poi ogni `SCAN_INTERVAL_MS` (5 minuti di default).
Se togli una cartella, il gioco sparisce dalla libreria.

## 4. Come si gioca

1. Tu e il tuo amico apri il sito e fate login con la stessa password.
2. Lui clicca **Gioca** su un gioco.
3. L'agent lo avvia nella VM e apre `capture.html` in un browser **dentro la VM**.
4. Tu (che vedi lo schermo della VM tramite VMware) clicchi **Condividi schermo**
   e scegli **"Intero schermo"** (non solo la finestra — serve per l'audio).
5. Il tuo amico viene portato sulla pagina **Gioca**, vede lo schermo e può
   controllare con il joystick.

Una sessione alla volta: se uno sta già giocando, gli altri pulsanti "Gioca"
restano bloccati finché non finisce.

## 5. Joystick (controller Xbox)

Il browser dell'amico legge il controller con la **Gamepad API** (la stessa
tecnologia di Xbox Cloud Gaming, quindi funziona anche dal browser della Xbox)
e manda lo stato al server, che lo passa all'agent. L'agent lo inietta in un
**Xbox 360 Controller virtuale** tramite ViGEmBus, così il gioco lo vede come
un controller vero.

Se i movimenti risultano strani (es. assi invertiti), guarda i commenti in
`agent-win/gamepad-bridge.js` — è scritto apposta per essere facile da
correggere lì.

**Limite attuale**: solo joystick, non tastiera/mouse (visto che il tuo amico
gioca dalla Xbox, non sembrava necessario — fammi sapere se invece ti serve
anche quello).

## 6. Audio

`capture.html` prova a includere l'audio quando condividi **l'intero schermo**
(non funziona condividendo solo una finestra — limite del browser, non nostro).
Se non senti audio, controlla di aver scelto "Intero schermo" nel popup di
condivisione.

## 7. Accesso da reti diverse

Tailscale da solo **non basta**: su Xbox non si può installare nessun client
di terze parti. La soluzione più semplice è un **Cloudflare Tunnel**, che dà
un URL pubblico https raggiungibile da qualsiasi browser, senza installare
nulla dal lato di tuo amico:

1. Scarica `cloudflared` per Windows: https://github.com/cloudflare/cloudflared/releases
   (prendi `cloudflared-windows-amd64.exe`, rinominalo in `cloudflared.exe`)
2. Dentro la VM, con il sito già avviato su `localhost:3000`, apri un terminale
   dove hai messo `cloudflared.exe` e lancia:
   ```bat
   cloudflared.exe tunnel --url http://localhost:3000
   ```
3. Ti stampa un indirizzo tipo `https://parole-a-caso.trycloudflare.com`:
   quello è il link da dare al tuo amico (al posto dell'IP locale).
4. Tienilo aperto mentre giocate. Se lo chiudi e lo riapri, l'indirizzo cambia
   ogni volta — è il prezzo della versione gratuita "senza account". Se vuoi
   un indirizzo fisso che non cambia mai, serve un account Cloudflare gratuito
   + un dominio collegato (setup più lungo, te lo spiego se ti interessa).

La password del sito (`SITE_PASSWORD`) resta comunque attiva: chiunque trovi
l'URL deve comunque conoscerla per entrare.

## 8. Cosa ho testato io e cosa no

Ho un sandbox Linux, non una VM Windows con schermo/controller reali, quindi:

**Testato davvero (server e agent veri, non simulati):**
- scanner della libreria (aggiunta/rimozione giochi, cover, `game.json`)
- login con password e protezione delle pagine/API
- avvio di un gioco end-to-end: sito → agent → tentativo di lancio → gestione errori
- relay WebSocket completo: capture → server → viewer, e viewer → server → agent
- l'agent quando ViGEmBus non è installato (si disattiva da solo senza rompere il resto)

**NON testato (serve la VM reale per provarlo)**:
- la cattura schermo/audio vera in `capture.html` (richiede un browser Windows reale)
- l'iniezione effettiva nel controller virtuale tramite ViGEmBus (richiede il
  driver installato e un gioco vero che legga l'input)

Se qualcosa di queste due parti si comporta in modo strano la prima volta,
è normale: dimmi cosa vedi/cosa non va e lo aggiusto.

## Struttura del progetto

```
remote-play-web/
  server.js              il sito + il centralino WebSocket
  lib/                   scanner, db, sessioni, autenticazione
  public/                pagine per chi sta sul sito (libreria, login, gioca)
  capture/               pagina che gira nella VM e manda video/audio
  agent-win/             agent: avvia i giochi, inietta il joystick
  data/db.json           "database" locale (creato da solo al primo avvio)
  avvia-tutto.bat         avvia server + agent con un doppio clic
```
