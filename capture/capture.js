// capture/capture.js
// Gira nel browser DENTRO la VM. Cattura schermo (+ audio se possibile)
// e manda tutto al server via WebSocket, un frame JPEG alla volta.
//
// Protocollo binario: il primo byte del messaggio dice cosa contiene:
//   1 = frame video (JPEG)
//   2 = chunk audio (webm/opus)

const FRAME_INTERVAL_MS = 80; // ~12.5 fps: equilibrio fra fluidità e banda
const JPEG_QUALITY = 0.6;
const MAX_DIMENSION = 1280; // non mandiamo frame più grandi di così

const params = new URLSearchParams(location.search);
const sessionId = params.get('sessionId');

const shareBtn = document.getElementById('share-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const previewVideo = document.getElementById('preview');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false });

let ws = null;
let frameTimer = null;
let mediaRecorder = null;

function setStatus(text, live) {
  statusText.textContent = text;
  statusDot.classList.toggle('live', !!live);
}

function connectWs() {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProto}//${location.host}/ws/capture?sessionId=${sessionId}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => setStatus('connesso al server, pronto', false));
  ws.addEventListener('close', () => setStatus('disconnesso dal server', false));
  ws.addEventListener('error', () => setStatus('errore di connessione', false));
}

function sendBinary(typeByte, arrayBufferOrBlob) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  Promise.resolve(arrayBufferOrBlob instanceof Blob ? arrayBufferOrBlob.arrayBuffer() : arrayBufferOrBlob).then(
    (buf) => {
      const payload = new Uint8Array(buf.byteLength + 1);
      payload[0] = typeByte;
      payload.set(new Uint8Array(buf), 1);
      ws.send(payload);
    }
  );
}

function startFrameLoop(videoEl) {
  let { videoWidth: w, videoHeight: h } = videoEl;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w, h));
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);

  frameTimer = setInterval(() => {
    if (videoEl.readyState < 2) return;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) sendBinary(1, blob);
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }, FRAME_INTERVAL_MS);
}

function startAudioCapture(stream) {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    console.warn('Nessuna traccia audio (probabilmente hai condiviso solo una finestra, non lo schermo intero).');
    return;
  }
  const audioStream = new MediaStream(audioTracks);
  try {
    mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm;codecs=opus' });
  } catch (err) {
    console.warn('MediaRecorder non disponibile per audio:', err.message);
    return;
  }
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) sendBinary(2, ev.data);
  };
  mediaRecorder.start(250); // un chunk ogni 250ms
}

async function startSharing() {
  shareBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: true,
    });

    previewVideo.srcObject = stream;
    await previewVideo.play();

    startFrameLoop(previewVideo);
    startAudioCapture(stream);

    setStatus('condivisione attiva', true);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'started' }));
    }

    // L'utente può fermare la condivisione dalla barra nativa del browser.
    stream.getVideoTracks()[0].addEventListener('ended', stopSharing);
  } catch (err) {
    setStatus('condivisione annullata o negata', false);
    shareBtn.disabled = false;
  }
}

function stopSharing() {
  clearInterval(frameTimer);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  setStatus('condivisione interrotta', false);
  shareBtn.disabled = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'capture_stopped' }));
  }
}

if (!sessionId) {
  setStatus('URL senza sessionId, qualcosa non va', false);
} else {
  connectWs();
  shareBtn.addEventListener('click', startSharing);
}
