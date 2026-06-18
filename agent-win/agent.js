// agent-win/agent.js
// Gira DENTRO la VM Windows. Si collega al server via WebSocket e:
//  - quando il sito chiede di lanciare un gioco, lo avvia e apre capture.html
//  - quando il gioco si chiude, avvisa il sito
//  - quando arriva input dal joystick dell'amico, lo passa a gamepad-bridge

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

const {
  serverUrl = 'http://localhost:3000',
  agentSecret,
  openCapturePage = true,
  reconnectDelayMs = 3000,
} = config;

if (!agentSecret) {
  console.error('Manca "agentSecret" in config.json (deve essere identico a AGENT_SECRET del server).');
  process.exit(1);
}

const wsBase = serverUrl.replace(/^http/, 'ws');
const runningProcesses = new Map(); // sessionId -> ChildProcess

function openCaptureInBrowser(sessionId) {
  const url = `${serverUrl}/capture/capture.html?sessionId=${sessionId}`;
  exec(`start "" "${url}"`, (err) => {
    if (err) console.error('[agent] non riesco ad aprire il browser per capture.html:', err.message);
  });
}

function launchGame(ws, { sessionId, exePath, args }) {
  if (!fs.existsSync(exePath)) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message: `non trovo ${exePath}` }));
    return;
  }
  console.log(`[agent] avvio gioco: "${exePath}" ${args || ''} (sessione ${sessionId})`);

  const argList = (args || '').split(' ').filter(Boolean);
  let child;
  try {
    child = spawn(exePath, argList, {
      cwd: path.dirname(exePath),
      detached: true,
      stdio: 'ignore',
    });
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message: err.message }));
    return;
  }

  runningProcesses.set(sessionId, child);

  child.on('error', (err) => {
    console.error('[agent] errore avvio gioco:', err.message);
    ws.send(JSON.stringify({ type: 'error', sessionId, message: err.message }));
    runningProcesses.delete(sessionId);
  });

  child.on('exit', () => {
    console.log(`[agent] il gioco della sessione ${sessionId} si è chiuso`);
    runningProcesses.delete(sessionId);
    ws.send(JSON.stringify({ type: 'ended', sessionId }));
  });

  ws.send(JSON.stringify({ type: 'launched', sessionId }));
  if (openCapturePage) openCaptureInBrowser(sessionId);
}

function endSession(sessionId) {
  const child = runningProcesses.get(sessionId);
  if (!child) return;
  // taskkill con /T (tree) /F (force) chiude anche eventuali processi
  // figli che il gioco si fosse aperto (launcher, sotto-processi, ecc).
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
    else if (msg.type === 'input') gamepad.applyState(msg.gamepad);
  });

  ws.on('close', () => {
    console.warn(`[agent] disconnesso dal server, riprovo in ${reconnectDelayMs / 1000}s...`);
    setTimeout(connect, reconnectDelayMs);
  });

  ws.on('error', (err) => {
    console.error('[agent] errore websocket:', err.message);
  });
}

gamepad.init();
connect();
