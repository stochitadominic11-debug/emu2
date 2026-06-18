// lib/auth.js
// Il sito, una volta esposto su internet (Cloudflare Tunnel/Tailscale),
// non deve essere apribile da chiunque trovi l'URL. Non serve un
// sistema di account completo per due persone: basta UNA password
// condivisa, salvata in un cookie dopo il primo login.

const crypto = require('crypto');

const COOKIE_NAME = 'rpw_session';
const TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 giorni

// token -> timestamp di scadenza (ms). Vive in memoria: se il server
// si riavvia, tutti devono rifare login una volta. Va benissimo per
// questo uso.
const validTokens = new Map();

function getSitePassword() {
  const pwd = process.env.SITE_PASSWORD;
  if (!pwd) {
    throw new Error(
      'SITE_PASSWORD non impostata. Mettila nel file .env prima di avviare il server.'
    );
  }
  return pwd;
}

function checkPassword(candidate) {
  const real = getSitePassword();
  // Confronto a tempo costante per non regalare informazioni
  // tramite quanto velocemente risponde il server.
  const a = Buffer.from(String(candidate));
  const b = Buffer.from(String(real));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

function revokeToken(token) {
  validTokens.delete(token);
}

function isTokenValid(token) {
  if (!token) return false;
  const expiry = validTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    validTokens.delete(token);
    return false;
  }
  return true;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

// Middleware Express per le pagine/API "umane" (non per l'agent).
function requireAuth(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  if (isTokenValid(token)) {
    req.sessionToken = token;
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'non autenticato' });
  }
  return res.redirect('/login.html');
}

// Usata anche dal server WebSocket per validare la richiesta di upgrade.
function isRequestAuthenticated(req) {
  const cookies = parseCookies(req.headers.cookie);
  return isTokenValid(cookies[COOKIE_NAME]);
}

module.exports = {
  COOKIE_NAME,
  checkPassword,
  issueToken,
  revokeToken,
  isTokenValid,
  requireAuth,
  isRequestAuthenticated,
  parseCookies,
};
