// lib/scanner.js
// Cuore della "libreria automatica": guarda dentro GAMES_DIR ogni
// SCAN_INTERVAL_MS, e per ogni sottocartella che trova crea/aggiorna
// una scheda gioco. Se una cartella sparisce, il gioco sparisce dalla
// libreria. Nessun inserimento manuale richiesto.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readDb, writeDb } = require('./db');
const { placeholderCoverDataUrl } = require('./cover');

const EXE_EXTENSION = '.exe';
const COVER_FILENAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'folder.jpg', 'folder.png'];
const MAX_DEPTH_FOR_EXE = 2; // cerca l'exe anche un paio di livelli sotto

function stableIdFromPath(folderPath) {
  // Stesso percorso = stesso id sempre, anche dopo un riavvio del server.
  return crypto.createHash('sha1').update(folderPath).digest('hex').slice(0, 12);
}

function titleCaseFromFolderName(folderName) {
  return folderName
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function findFirstExe(dir, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Prima guarda i file in questa cartella (preferiamo un exe "diretto")
  const directExe = entries.find(
    (e) => e.isFile() && e.name.toLowerCase().endsWith(EXE_EXTENSION)
  );
  if (directExe) return path.join(dir, directExe.name);

  if (depth >= MAX_DEPTH_FOR_EXE) return null;

  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFirstExe(path.join(dir, e.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function findCoverImage(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const lowerMap = new Map(entries.map((e) => [e.name.toLowerCase(), e.name]));
  for (const candidate of COVER_FILENAMES) {
    if (lowerMap.has(candidate)) {
      return path.join(dir, lowerMap.get(candidate));
    }
  }
  return null;
}

function readOptionalGameJson(dir) {
  const jsonPath = path.join(dir, 'game.json');
  if (!fs.existsSync(jsonPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch {
    return {};
  }
}

function coverFileToDataUrl(coverPath) {
  const ext = path.extname(coverPath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  const buf = fs.readFileSync(coverPath);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

// Legge GAMES_DIR e ritorna l'elenco "vero" dei giochi trovati ORA sul disco.
function scanGamesDir(gamesDir) {
  const found = [];

  if (!fs.existsSync(gamesDir)) {
    console.warn(`[scanner] la cartella ${gamesDir} non esiste (ancora). Libreria vuota.`);
    return found;
  }

  let entries;
  try {
    entries = fs.readdirSync(gamesDir, { withFileTypes: true });
  } catch (err) {
    console.error(`[scanner] non riesco a leggere ${gamesDir}:`, err.message);
    return found;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue; // ogni gioco = una sottocartella

    const folderPath = path.join(gamesDir, entry.name);
    const exePath = findFirstExe(folderPath);
    if (!exePath) {
      // Cartella senza nessun .exe dentro: la ignoriamo, non è (ancora) un gioco.
      continue;
    }

    const meta = readOptionalGameJson(folderPath);
    const name = meta.name || titleCaseFromFolderName(entry.name);
    const coverPath = findCoverImage(folderPath);

    found.push({
      id: stableIdFromPath(folderPath),
      name,
      exePath,
      args: meta.args || '',
      folderPath,
      coverDataUrl: coverPath ? coverFileToDataUrl(coverPath) : placeholderCoverDataUrl(name),
      hasCustomCover: !!coverPath,
    });
  }

  return found;
}

// Confronta quello che c'è oggi sul disco con quello che c'è nel db,
// e aggiorna il db di conseguenza (aggiunte, rimozioni, aggiornamenti).
function syncLibraryWithDisk(gamesDir) {
  const db = readDb();
  const foundGames = scanGamesDir(gamesDir);
  const foundIds = new Set(foundGames.map((g) => g.id));

  const existingById = new Map(db.games.map((g) => [g.id, g]));

  const nextGames = foundGames.map((g) => {
    const existing = existingById.get(g.id);
    return {
      ...g,
      addedAt: existing ? existing.addedAt : new Date().toISOString(),
    };
  });

  const removedCount = db.games.filter((g) => !foundIds.has(g.id)).length;
  const addedCount = nextGames.filter((g) => !existingById.has(g.id)).length;

  db.games = nextGames;
  writeDb(db);

  if (addedCount || removedCount) {
    console.log(`[scanner] libreria aggiornata: +${addedCount} nuovi, -${removedCount} rimossi (totale ${nextGames.length})`);
  }

  return { addedCount, removedCount, total: nextGames.length };
}

function startScanLoop(gamesDir, intervalMs) {
  syncLibraryWithDisk(gamesDir); // scansione immediata all'avvio
  const timer = setInterval(() => syncLibraryWithDisk(gamesDir), intervalMs);
  return () => clearInterval(timer); // funzione per fermare il loop (utile nei test)
}

module.exports = {
  scanGamesDir,
  syncLibraryWithDisk,
  startScanLoop,
  // esportate per i test:
  titleCaseFromFolderName,
  stableIdFromPath,
};
