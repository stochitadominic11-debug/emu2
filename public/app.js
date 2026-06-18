const gamesEl = document.getElementById('games');
const statusEl = document.getElementById('status');

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Errore richiesta');
  return data;
}

async function load() {
  const [status, games] = await Promise.all([api('/api/status'), api('/api/games')]);
  statusEl.textContent = status.agentConnected
    ? `agent online - ${status.gamesDir}`
    : `agent offline - ${status.gamesDir}`;
  gamesEl.innerHTML = games.games.length
    ? games.games.map(renderGame).join('')
    : '<article class="panel">Nessun gioco trovato in libreria.</article>';
}

function renderGame(game) {
  return `
    <article class="card">
      <img src="${game.coverDataUrl}" alt="" />
      <div>
        <h2>${escapeHtml(game.name)}</h2>
        <button class="primary" data-play="${game.id}" ${game.isActive ? 'disabled' : ''}>
          ${game.isActive ? 'In corso' : 'Gioca'}
        </button>
        ${game.isActive ? `<a class="ghost link" href="/play.html?sessionId=${game.activeSessionId}">Apri sessione</a>` : ''}
      </div>
    </article>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

gamesEl.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-play]');
  if (!button) return;
  button.disabled = true;
  button.textContent = 'Avvio...';
  try {
    const data = await api(`/api/games/${button.dataset.play}/play`, { method: 'POST' });
    location.href = `/play.html?sessionId=${encodeURIComponent(data.sessionId)}`;
  } catch (err) {
    alert(err.message);
    await load();
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  location.href = '/login.html';
});

load().catch((err) => {
  gamesEl.innerHTML = `<article class="panel error">${escapeHtml(err.message)}</article>`;
});
