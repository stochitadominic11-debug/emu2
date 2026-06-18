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

function startCaptureAgent(sessionId) {
  if (!fs.existsSync(captureAgentPath)) {
    console.error('[agent] CaptureAgent.exe non trovato:', captureAgentPath);
    return;
  }

  console.log('[agent] start capture:', captureAgentPath);

  const child = spawn(captureAgentPath, [
    '--serverUrl', serverUrl,
    '--agentSecret', agentSecret,
    '--sessionId', sessionId,
    '--processName', captureProcessName,
    '--targetFps', '30',
    '--jpegQuality', '75',
    '--maxDimension', '1280',
    '--reconnectDelayMs', String(reconnectDelayMs),
    '--verbose', 'true'
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });

  child.unref();
}

function launchGame(ws, { sessionId, exePath, args }) {
  if (!fs.existsSync(exePath)) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message: `non trovo ${exePath}` }));
	console.log('[DEBUG exePath]', exePath);
	console.log('[DEBUG exists game]', fs.existsSync(exePath));
    return;
  }

  console.log(`[agent] avvio gioco: "${exePath}"`);

  const argList = (args || '').split(' ').filter(Boolean);

  const child = spawn(exePath, argList, {
    cwd: path.dirname(exePath),
    detached: true,
    stdio: 'ignore',
  });

  runningProcesses.set(sessionId, child);

  child.on('exit', () => {
    runningProcesses.delete(sessionId);
    ws.send(JSON.stringify({ type: 'ended', sessionId }));
  });

  ws.send(JSON.stringify({ type: 'launched', sessionId }));

  startCaptureAgent(sessionId);
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
    else if (msg.type === 'input') gamepad.applyState(msg.gamepad);
  });

  ws.on('close', () => {
    console.warn(`[agent] disconnesso, retry in ${reconnectDelayMs}s`);
    setTimeout(connect, reconnectDelayMs);
  });

  ws.on('error', (err) => {
    console.error('[agent] websocket error:', err.message);
  });
}

gamepad.init();
connect();