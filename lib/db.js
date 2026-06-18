// lib/db.js
// Database locale super semplice: tutto in un file JSON.
// Non serve Postgres/Prisma per due persone che giocano insieme.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

const EMPTY_DB = {
  games: [],       // [{ id, name, exePath, args, coverDataUrl, folderPath, addedAt }]
  sessions: [],     // [{ id, gameId, status, createdAt, endedAt }]
};

function ensureDbFile() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
  }
}

function readDb() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    // Garantisce che le chiavi principali esistano sempre,
    // anche se il file è vecchio o è stato modificato a mano.
    return { ...EMPTY_DB, ...parsed };
  } catch (err) {
    console.error('[db] file db.json corrotto o illeggibile, lo ricreo vuoto:', err.message);
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY_DB, null, 2));
    return { ...EMPTY_DB };
  }
}

// Scrittura "atomica": scrivo su un file temporaneo e poi rinomino,
// così se il processo si interrompe a metà non corrompo il db.
function writeDb(data) {
  ensureDbFile();
  const tmpPath = DB_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

module.exports = { readDb, writeDb, DB_PATH };
