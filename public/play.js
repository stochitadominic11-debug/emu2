const params = new URLSearchParams(location.search);
const sessionId = params.get('sessionId');
const statusEl = document.getElementById('status');
const videoEl = document.getElementById('video');
const emptyEl = document.getElementById('empty');

let ws;
let lastUrl = null;
let lastInputSent = 0;
let audioEl = null;
let mediaSource = null;
let sourceBuffer = null;
const audioQueue = [];

function setStatus(text) {
  statusEl.textContent = text;
}

function initAudio() {
  if (audioEl) return;
  audioEl = new Audio();
  audioEl.autoplay = true;
  audioEl.controls = false;
  audioEl.muted = false;
  document.body.appendChild(audioEl);

  mediaSource = new MediaSource();
  audioEl.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener('sourceopen', () => {
    const mime = 'audio/webm; codecs="opus"';
    if (!MediaSource.isTypeSupported(mime)) {
      setStatus('audio non supportato dal browser');
      return;
    }
    sourceBuffer = mediaSource.addSourceBuffer(mime);
    sourceBuffer.mode = 'sequence';
    sourceBuffer.addEventListener('updateend', flushAudioQueue);
    flushAudioQueue();
  });
  audioEl.play().catch(() => {});
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws/view?sessionId=${encodeURIComponent(sessionId)}`);
  ws.binaryType = 'arraybuffer';
  ws.addEventListener('open', () => setStatus('connesso'));
  ws.addEventListener('close', () => setStatus('disconnesso'));
  ws.addEventListener('error', () => setStatus('errore websocket'));
  ws.addEventListener('message', onMessage);
}

function onMessage(event) {
  if (typeof event.data === 'string') {
    const msg = JSON.parse(event.data);
    if (msg.type === 'session_ended') {
      setStatus(`sessione chiusa: ${msg.reason || ''}`);
    } else if (msg.type === 'capture_disconnected') {
      setStatus('capture disconnessa');
    }
    return;
  }

  const packet = new Uint8Array(event.data);
  const type = packet[0];
  const payload = packet.slice(1);
  if (type === 1) renderVideo(payload);
  if (type === 2) playAudio(payload);
}

function renderVideo(payload) {
  const blob = new Blob([payload], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  videoEl.src = url;
  videoEl.onload = () => {
    if (lastUrl) URL.revokeObjectURL(lastUrl);
    lastUrl = url;
  };
  emptyEl.style.display = 'none';
}

async function playAudio(payload) {
  try {
    initAudio();
    audioQueue.push(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength));
    flushAudioQueue();
  } catch {
    // Keep video and input alive even if audio fails.
  }
}

function flushAudioQueue() {
  if (!sourceBuffer || sourceBuffer.updating || audioQueue.length === 0) return;
  try {
    sourceBuffer.appendBuffer(audioQueue.shift());
    if (audioEl && audioEl.paused) audioEl.play().catch(() => {});
  } catch {
    audioQueue.length = 0;
  }
}

function sendInput() {
  if (!ws || ws.readyState !== WebSocket.OPEN || !navigator.getGamepads) return;
  const now = performance.now();
  if (now - lastInputSent < 16) return;
  const pad = Array.from(navigator.getGamepads()).find(Boolean);
  if (!pad) return;
  lastInputSent = now;
  ws.send(JSON.stringify({
    type: 'input',
    gamepad: {
      buttons: pad.buttons.map((button) => button.value),
      axes: pad.axes.map((axis) => Number(axis.toFixed(4))),
    },
  }));
}

document.body.addEventListener('click', () => {
  initAudio();
  if (audioEl) audioEl.play().catch(() => {});
}, { once: true });
document.getElementById('end').addEventListener('click', async () => {
  await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST' });
  location.href = '/';
});

window.addEventListener('gamepadconnected', () => setStatus('controller collegato'));
setInterval(sendInput, 16);

if (!sessionId) {
  setStatus('sessionId mancante');
} else {
  connect();
}
