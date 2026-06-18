// lib/cover.js
// Se un gioco non ha un cover.jpg/cover.png nella sua cartella,
// generiamo una copertina semplice: sfondo colorato + iniziale del nome.
// Niente chiamate esterne, niente API key, funziona sempre offline.

// Palette curata (non colori a caso) - tonalità che si leggono bene
// con testo bianco sopra.
const PALETTE = [
  '#3B5BDB', // indaco
  '#9C36B5', // viola
  '#E03131', // rosso
  '#E8590C', // arancio
  '#2F9E44', // verde
  '#0C8599', // teal
  '#5C5F66', // grigio ardesia
  '#C2255C', // magenta
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function placeholderCoverDataUrl(name) {
  const color = PALETTE[hashString(name) % PALETTE.length];
  const initial = (name.trim()[0] || '?').toUpperCase();

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
  <rect width="300" height="400" fill="${color}"/>
  <rect width="300" height="400" fill="black" opacity="0.12"/>
  <text x="150" y="230" font-family="'Outfit', 'Segoe UI', sans-serif" font-size="140"
        font-weight="700" fill="white" text-anchor="middle" opacity="0.92">${initial}</text>
</svg>`.trim();

  return 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
}

module.exports = { placeholderCoverDataUrl };
