const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const WebSocket = require('ws');
const gamepad = require('./gamepad-bridge');

const configPath = process.argv[2] || 'config.json';

if (!fs.existsSync(configPath)) {
  console.error(`Non trovo "${configPath}". Copia config.example.json in config.json e modificalo.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const serverUrl = config.serverUrl || 'http://localhost:3000';
const agentSecret = config.agentSecret;

// Joystick Xbox virtuale (ViGEm). Per i giochi tastiera+mouse va tenuto SPENTO:
// se acceso, il gioco "vede un controller collegato" e nei menu il tasto B fa
// da Indietro / il cursore ruba la selezione, facendo rimbalzare indietro la
// navigazione. Disattivandolo, il gioco è guidato solo da tastiera+mouse
// (gestiti dal capture-agent). Default: acceso, per i giochi che lo supportano.
const useVirtualGamepad = config.virtualGamepad !== false;

const defaultCapturePath = path.join(
  __dirname,
  'capture-agent',
  'bin',
  'Release',
  'net8.0-windows',
  'CaptureAgent.exe'
);

const captureAgentPath = config.captureAgentPath || defaultCapturePath;

const captureProcessName =
  config.captureProcessName || 'Gamble With Your Friends';

const reconnectDelayMs = config.reconnectDelayMs || 3000;

const wsBase = serverUrl.replace(/^http/, 'ws');

const runningProcesses = new Map();
let inputReceivedCount = 0; // solo per il log diagnostico

function startCaptureAgent(sessionId, processName) {
  if (!fs.existsSync(captureAgentPath)) {
    console.error('[agent] CaptureAgent.exe non trovato:', captureAgentPath);
    return;
  }

  console.log('[agent] start capture:', captureAgentPath, '(processo da cercare:', processName, ')');

  const child = spawn(captureAgentPath, [
    '--serverUrl', serverUrl,
    '--agentSecret', agentSecret,
    '--sessionId', sessionId,
    '--processName', processName || captureProcessName,
    '--targetFps', '18',
    '--jpegQuality', '55',
    '--maxDimension', '960',
    '--reconnectDelayMs', String(reconnectDelayMs),
    '--verbose', 'true'
  ], {
    detached: true,
    // 'pipe' invece di 'ignore': così vediamo i log del capture nella stessa finestra
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // Stampa l'output di CaptureAgent prefissato da [capture] nella console dell'agent
  child.stdout.on('data', (d) => process.stdout.write(d.toString()));
  child.stderr.on('data', (d) => process.stderr.write(d.toString()));
  child.on('exit', (code) => console.log(`[capture] processo terminato (exit ${code})`));

  // Non chiamiamo child.unref() mentre leggiamo stdout/stderr,
  // ma CaptureAgent si chiude da solo quando il gioco termina.
}

function launchGame(ws, { sessionId, exePath, args }) {
  if (!fs.existsSync(exePath)) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message: `non trovo ${exePath}` }));
    console.log('[DEBUG exePath]', exePath);
    console.log('[DEBUG exists game]', fs.existsSync(exePath));
    return;
  }

  console.log(`[agent] avvio gioco: "${exePath}"`);

  // Il nome del processo da cercare per la cattura schermo è quello del file
  // .exe appena lanciato, non un valore fisso: così funziona con qualsiasi
  // gioco della libreria, non solo con quello usato durante i test.
  const processName = path.basename(exePath, path.extname(exePath));

  const argList = (args || '').split(' ').filter(Boolean);

  const child = spawn(exePath, argList, {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: 'ignore',
  });

  runningProcesses.set(sessionId, child);

  child.on('error', (err) => {
    console.error('[agent] errore avvio gioco:', err.message);
    ws.send(JSON.stringify({ type: 'error', sessionId, message: err.message }));
    runningProcesses.delete(sessionId);
  });

  child.on('exit', () => {
    runningProcesses.delete(sessionId);
    ws.send(JSON.stringify({ type: 'ended', sessionId }));
  });

  ws.send(JSON.stringify({ type: 'launched', sessionId }));

  // Aspetta che il gioco abbia il tempo di creare la sua finestra principale
  // prima di avviare il capture (tipicamente 3-10 secondi per la maggior parte dei giochi).
  // Senza questo delay, CaptureAgent trova il processo ma MainWindowHandle è ancora 0
  // e va in un loop di riconnessione.
  const CAPTURE_START_DELAY_MS = 8000;
  console.log(`[agent] avvio capture tra ${CAPTURE_START_DELAY_MS / 1000}s (attendo finestra del gioco)...`);
  setTimeout(() => startCaptureAgent(sessionId, processName), CAPTURE_START_DELAY_MS);
}

function endSession(sessionId) {
  const child = runningProcesses.get(sessionId);
  if (!child) return;

  exec(`taskkill /PID ${child.pid} /T /F`, () => {
    runningProcesses.delete(sessionId);
  });
}

function connect() {
  console.log(`[agent] mi connetto a ${wsBase}/ws/agent ...`);

  const ws = new WebSocket(`${wsBase}/ws/agent?secret=${encodeURIComponent(agentSecret)}`);

  ws.on('open', () => console.log('[agent] connesso al server ✅'));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'launch') launchGame(ws, msg);
    else if (msg.type === 'end') endSession(msg.sessionId);
    else if (msg.type === 'input') {
      // Se il joystick virtuale è spento, l'input lo gestisce SOLO il
      // capture-agent (tastiera+mouse): qui non facciamo nulla.
      if (useVirtualGamepad) {
        inputReceivedCount++;
        if (inputReceivedCount % 20 === 1) {
          console.log(`[agent] input ricevuto dal server (#${inputReceivedCount}) -> gamepad virtuale ${gamepad.isAvailable() ? 'disponibile ✅' : 'NON disponibile ❌ (ViGEmBus?)'}`);
        }
        gamepad.applyState(msg.gamepad);
      }
    }
  });

  ws.on('close', () => {
    console.warn(`[agent] disconnesso, retry in ${reconnectDelayMs}s`);
    setTimeout(connect, reconnectDelayMs);
  });

  ws.on('error', (err) => {
    console.error('[agent] websocket error:', err.message);
  });
}

if (useVirtualGamepad) {
  gamepad.init();
} else {
  console.log('[agent] joystick virtuale DISATTIVATO (virtualGamepad:false). I controlli vanno solo a tastiera+mouse via capture-agent.');
}
connect();