// lib/sessions.js
// Una "sessione" = un giro di gioco in corso: c'è un solo VM e un solo
// schermo da catturare, quindi per ora supportiamo UNA sessione attiva
// alla volta. Tutto in memoria: se il server si riavvia, la sessione
// finisce (è corretto: anche il gioco nella VM andrebbe riavviato).

const crypto = require('crypto');

let activeSession = null; // { id, gameId, gameName, status, createdAt }

const STATUS = {
  LAUNCHING: 'launching', // comando mandato all'agent, gioco non ancora confermato
  STREAMING: 'streaming', // capture.html ha iniziato a mandare frame
  ENDED: 'ended',
};

function createSession(game) {
  activeSession = {
    id: crypto.randomUUID(),
    gameId: game.id,
    gameName: game.name,
    status: STATUS.LAUNCHING,
    createdAt: new Date().toISOString(),
  };
  return activeSession;
}

function getActiveSession() {
  return activeSession;
}

function getSession(sessionId) {
  return activeSession && activeSession.id === sessionId ? activeSession : null;
}

function setStatus(sessionId, status) {
  if (activeSession && activeSession.id === sessionId) {
    activeSession.status = status;
  }
}

function endSession(sessionId) {
  if (activeSession && activeSession.id === sessionId) {
    activeSession = null;
    return true;
  }
  return false;
}

module.exports = {
  STATUS,
  createSession,
  getActiveSession,
  getSession,
  setStatus,
  endSession,
};
