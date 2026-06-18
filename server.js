// server.js
// Il sito vero e proprio. Gira DENTRO la VM Windows insieme all'agent.
//
// Cosa fa:
//  - scansiona GAMES_DIR ogni SCAN_INTERVAL_MS e tiene la libreria sincronizzata
//  - serve le pagine (libreria, login, pagina "gioca", pagina di capture)
//  - fa da centralino WebSocket fra tre attori:
//      capture.html (nella VM, manda video/audio)  -----\
//                                                          > server.js
//      play.html    (dell'amico, riceve video/audio,      /
//                     manda i comandi del joystick)  -----/
//      agent.js     (nella VM, lancia il gioco e inietta
//                     i comandi del joystick nel driver virtuale)

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cookie = require('cookie');
const { WebSocketServer } = require('ws');

const { readDb } = require('./lib/db');
const { startScanLoop } = require('./lib/scanner');
const sessions = require('./lib/sessions');
const auth = require('./lib/auth');

const PORT = parseInt(process.env.PORT || '3000', 10);
const GAMES_DIR = process.env.GAMES_DIR || 'C:\\games';
const SCAN_INTERVAL_MS = parseInt(process.env.SCAN_INTERVAL_MS || String(5 * 60 * 1000), 10);
const AGENT_SECRET = process.env.AGENT_SECRET || '';

if (!AGENT_SECRET) {
  console.warn('[server] ATTENZIONE: AGENT_SECRET non impostato. L\'agent non potrà collegarsi.');
}

const app = express();
app.use(express.json());

// ---------- Login (nessuna autenticazione richiesta per queste rotte) ----------

app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (!password || !auth.checkPassword(password)) {
    return res.status(401).json({ error: 'password sbagliata' });
  }
  const token = auth.issueToken();
  res.setHeader(
    'Set-Cookie',
    cookie.serialize(auth.COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 90 * 24 * 60 * 60,
      path: '/',
    })
  );
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  if (cookies[auth.COOKIE_NAME]) auth.revokeToken(cookies[auth.COOKIE_NAME]);
  res.setHeader('Set-Cookie', cookie.serialize(auth.COOKIE_NAME, '', { maxAge: 0, path: '/' }));
  res.json({ ok: true });
});

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ---------- Da qui in poi, serve la password ----------
app.use(auth.requireAuth);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/capture', express.static(path.join(__dirname, 'capture')));

function publicGameView(game) {
  const active = sessions.getActiveSession();
  return {
    id: game.id,
    name: game.name,
    coverDataUrl: game.coverDataUrl,
    addedAt: game.addedAt,
    isActive: !!active && active.gameId === game.id && active.status !== sessions.STATUS.ENDED,
    activeSessionId: active && active.gameId === game.id ? active.id : null,
  };
}

app.get('/api/games', (req, res) => {
  const db = readDb();
  res.json({ games: db.games.map(publicGameView) });
});

app.get('/api/session/active', (req, res) => {
  res.json({ session: sessions.getActiveSession() });
});

app.get('/api/status', (req, res) => {
  res.json({
    agentConnected: !!(wsHub.agent && wsHub.agent.readyState === wsHub.agent.OPEN),
    gamesDir: GAMES_DIR,
    scanIntervalMs: SCAN_INTERVAL_MS,
  });
});

app.post('/api/games/:id/play', (req, res) => {
  const db = readDb();
  const game = db.games.find((g) => g.id === req.params.id);
  if (!game) return res.status(404).json({ error: 'gioco non trovato' });

  const existing = sessions.getActiveSession();
  if (existing && existing.status !== sessions.STATUS.ENDED) {
    if (existing.gameId === game.id) {
      // Sta già giocando a questo: ridagli la stessa sessione invece di
      // lanciarlo due volte.
      return res.json({ sessionId: existing.id });
    }
    return res.status(409).json({
      error: `c'è già una sessione attiva (${existing.gameName}). Terminala prima di avviarne un'altra.`,
    });
  }

  if (!wsHub.agent || wsHub.agent.readyState !== wsHub.agent.OPEN) {
    return res.status(503).json({
      error: "l'agent non è connesso. Avvia agent.js sulla VM e riprova.",
    });
  }

  const session = sessions.createSession(game);
  wsHub.sendToAgent({
    type: 'launch',
    sessionId: session.id,
    exePath: game.exePath,
    args: game.args || '',
  });

  res.json({ sessionId: session.id });
});

app.post('/api/sessions/:id/end', (req, res) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'sessione non trovata' });

  wsHub.sendToAgent({ type: 'end', sessionId: session.id });
  sessions.endSession(session.id);
  wsHub.notifyViewer(session.id, { type: 'session_ended', reason: 'fermata manualmente' });
  res.json({ ok: true });
});

// ====================================================================
// WebSocket: capture (VM) <-> server <-> view (amico), e server <-> agent
// ====================================================================

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// sessionId -> { capture: ws|null, viewer: ws|null }
const sessionSockets = new Map();

function getOrCreateSlot(sessionId) {
  if (!sessionSockets.has(sessionId)) {
    sessionSockets.set(sessionId, { capture: null, viewer: null });
  }
  return sessionSockets.get(sessionId);
}

const wsHub = {
  agent: null,
  sendToAgent(msg) {
    if (this.agent && this.agent.readyState === this.agent.OPEN) {
      this.agent.send(JSON.stringify(msg));
    }
  },
  notifyViewer(sessionId, msg) {
    const slot = sessionSockets.get(sessionId);
    if (slot && slot.viewer && slot.viewer.readyState === slot.viewer.OPEN) {
      slot.viewer.send(JSON.stringify(msg));
    }
  },
  notifyCapture(sessionId, msg) {
    const slot = sessionSockets.get(sessionId);
    if (slot && slot.capture && slot.capture.readyState === slot.capture.OPEN) {
      slot.capture.send(JSON.stringify(msg));
    }
  },
};

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/ws/agent') {
    if (url.searchParams.get('secret') !== AGENT_SECRET || !AGENT_SECRET) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => handleAgentConnection(ws));
    return;
  }

  if (url.pathname === '/ws/capture' || url.pathname === '/ws/view') {
    if (!auth.isRequestAuthenticated(req)) {
      socket.destroy();
      return;
    }
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (url.pathname === '/ws/capture') handleCaptureConnection(ws, sessionId);
      else handleViewerConnection(ws, sessionId);
    });
    return;
  }

  socket.destroy();
});

function handleAgentConnection(ws) {
  console.log('[ws] agent connesso');
  wsHub.agent = ws;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'launched') {
      sessions.setStatus(msg.sessionId, sessions.STATUS.STREAMING);
    } else if (msg.type === 'ended') {
      sessions.endSession(msg.sessionId);
      wsHub.notifyViewer(msg.sessionId, { type: 'session_ended', reason: 'il gioco è stato chiuso' });
    } else if (msg.type === 'error') {
      sessions.endSession(msg.sessionId);
      wsHub.notifyViewer(msg.sessionId, { type: 'session_ended', reason: msg.message || 'errore avvio' });
    }
  });

  ws.on('close', () => {
    console.log('[ws] agent disconnesso');
    if (wsHub.agent === ws) wsHub.agent = null;
  });
}

function handleCaptureConnection(ws, sessionId) {
  console.log(`[ws] capture connesso per sessione ${sessionId}`);
  const slot = getOrCreateSlot(sessionId);
  slot.capture = ws;

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // frame video o chunk audio: lo passo dritto al viewer, senza
      // toccarlo (così non perdo tempo/latenza a parsare nulla).
      const target = sessionSockets.get(sessionId);
      if (target && target.viewer && target.viewer.readyState === target.viewer.OPEN) {
        target.viewer.send(data, { binary: true });
      }
      return;
    }
    // messaggi di controllo testuali (es. {type:'started'})
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'started') sessions.setStatus(sessionId, sessions.STATUS.STREAMING);
      wsHub.notifyViewer(sessionId, msg);
    } catch {
      /* ignoro messaggi malformati */
    }
  });

  ws.on('close', () => {
    const target = sessionSockets.get(sessionId);
    if (target) target.capture = null;
    wsHub.notifyViewer(sessionId, { type: 'capture_disconnected' });
  });
}

function handleViewerConnection(ws, sessionId) {
  console.log(`[ws] viewer connesso per sessione ${sessionId}`);
  const slot = getOrCreateSlot(sessionId);
  slot.viewer = ws;

  ws.on('message', (data, isBinary) => {
    if (isBinary) return; // il viewer non manda mai binario, solo JSON
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (msg.type === 'input') {
      // Il joystick (o tastiera/mouse) dell'amico va dritto all'agent,
      // MAI a capture.html: un tab di browser non può iniettare input
      // nel sistema, solo agent.js può farlo (ha accesso nativo a Windows).
      wsHub.sendToAgent({ type: 'input', sessionId, gamepad: msg.gamepad });
    }
  });

  ws.on('close', () => {
    const target = sessionSockets.get(sessionId);
    if (target) target.viewer = null;
  });
}

// ====================================================================

startScanLoop(GAMES_DIR, SCAN_INTERVAL_MS);

server.listen(PORT, () => {
  console.log(`[server] in ascolto su http://localhost:${PORT}`);
  console.log(`[server] cartella giochi: ${GAMES_DIR} (scansione ogni ${SCAN_INTERVAL_MS / 1000}s)`);
});

module.exports = { app, server };
