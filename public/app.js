// public/app.js — pagina Libreria

const grid = document.getElementById('grid');
const emptyState = document.getElementById('empty-state');
const banner = document.getElementById('banner');
const agentDot = document.getElementById('agent-dot');
const agentText = document.getElementById('agent-text');
const gamesDirPath = document.getElementById('games-dir-path');

const POLL_MS = 5000;
let busy = false; // evita doppi click mentre una richiesta "play" è in corso

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    location.href = '/login.html?next=' + encodeURIComponent(location.pathname);
    throw new Error('non autenticato');
  }
  return res;
}

function showBanner(text) {
  banner.textContent = text;
  banner.classList.add('show');
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => banner.classList.remove('show'), 5000);
}

function coverPlaceholderFallback(ev) {
  ev.target.style.display = 'none';
}

function renderGames(games) {
  if (games.length === 0) {
    grid.style.display = 'none';
    emptyState.style.display = 'block';
    return;
  }
  grid.style.display = 'grid';
  emptyState.style.display = 'none';

  grid.innerHTML = '';
  for (const game of games) {
    const card = document.createElement('div');
    card.className = 'card';

    const img = document.createElement('img');
    img.className = 'cover';
    img.src = game.coverDataUrl;
    img.alt = game.name;
    img.loading = 'lazy';

    const body = document.createElement('div');
    body.className = 'body';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = game.name;

    const liveRow = document.createElement('div');
    liveRow.className = 'live-row';
    liveRow.innerHTML = `<span class="status-dot ${game.isActive ? 'live' : ''}"></span>
      <span>${game.isActive ? 'In corso' : 'Pronto'}</span>`;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'primary';
    playBtn.textContent = game.isActive ? 'Vai alla sessione' : 'Gioca';
    playBtn.addEventListener('click', () => onPlayClick(game, playBtn));

    actions.appendChild(playBtn);
    body.append(name, liveRow, actions);
    card.append(img, body);
    grid.appendChild(card);
  }
}

async function onPlayClick(game, btn) {
  if (busy) return;
  busy = true;
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = game.isActive ? 'Apro…' : 'Avvio…';

  try {
    if (game.isActive && game.activeSessionId) {
      location.href = `/play.html?session=${game.activeSessionId}`;
      return;
    }
    const res = await api(`/api/games/${game.id}/play`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showBanner(data.error || 'Non sono riuscito ad avviare il gioco.');
      return;
    }
    location.href = `/play.html?session=${data.sessionId}`;
  } catch (err) {
    showBanner('Errore di rete: ' + err.message);
  } finally {
    busy = false;
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function refresh() {
  try {
    const [statusRes, gamesRes] = await Promise.all([api('/api/status'), api('/api/games')]);
    const status = await statusRes.json();
    const { games } = await gamesRes.json();

    agentDot.classList.toggle('live', status.agentConnected);
    agentText.textContent = status.agentConnected ? 'agent connesso' : 'agent non connesso';
    gamesDirPath.textContent = status.gamesDir;

    renderGames(games);
  } catch {
    agentText.textContent = 'errore di connessione al server';
  }
}

refresh();
setInterval(refresh, POLL_MS);
