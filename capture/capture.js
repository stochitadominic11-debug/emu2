// Runs in the VM browser. Captures screen/audio and forwards it to the viewer.
// Binary packet protocol:
//   byte 0 = 1: JPEG video frame
//   byte 0 = 2: webm/opus audio chunk

const TARGET_FPS = 60;
const FRAME_INTERVAL_MS = Math.round(1000 / TARGET_FPS);
const JPEG_QUALITY = 0.72;
const MAX_DIMENSION = 1280;
const AUDIO_CHUNK_MS = 100;

const params = new URLSearchParams(location.search);
const sessionId = params.get('sessionId');
const autoStart = params.get('autoStart') === '1';

const shareBtn = document.getElementById('share-btn');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const previewVideo = document.getElementById('preview');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

let ws = null;
let frameTimer = null;
let mediaRecorder = null;
let encodingFrame = false;

function setStatus(text, live) {
  statusText.textContent = text;
  statusDot.classList.toggle('live', !!live);
}

function connectWs() {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProto}//${location.host}/ws/capture?sessionId=${encodeURIComponent(sessionId)}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => setStatus('connected, ready', false));
  ws.addEventListener('close', () => setStatus('server disconnected', false));
  ws.addEventListener('error', () => setStatus('connection error', false));
}

async function sendBinary(typeByte, arrayBufferOrBlob) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  if (ws.bufferedAmount > 16 * 1024 * 1024) return;
  const buf = arrayBufferOrBlob instanceof Blob ? await arrayBufferOrBlob.arrayBuffer() : arrayBufferOrBlob;
  const payload = new Uint8Array(buf.byteLength + 1);
  payload[0] = typeByte;
  payload.set(new Uint8Array(buf), 1);
  ws.send(payload);
}

function startFrameLoop(videoEl) {
  const { videoWidth: w, videoHeight: h } = videoEl;
  const scale = Math.min(1, MAX_DIMENSION / Math.max(w || 1, h || 1));
  canvas.width = Math.max(2, Math.round(w * scale));
  canvas.height = Math.max(2, Math.round(h * scale));

  frameTimer = setInterval(() => {
    if (videoEl.readyState < 2 || encodingFrame) return;
    if (ws && ws.bufferedAmount > 8 * 1024 * 1024) return;
    encodingFrame = true;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) sendBinary(1, blob).finally(() => { encodingFrame = false; });
        else encodingFrame = false;
      },
      'image/jpeg',
      JPEG_QUALITY
    );
  }, FRAME_INTERVAL_MS);
}

function startAudioCapture(stream) {
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    console.warn('No audio track. In Chrome/Edge, choose entire screen and enable system audio.');
    return;
  }

  try {
    mediaRecorder = new MediaRecorder(new MediaStream(audioTracks), { mimeType: 'audio/webm;codecs=opus' });
  } catch (err) {
    console.warn('MediaRecorder audio unavailable:', err.message);
    return;
  }

  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) sendBinary(2, ev.data);
  };
  mediaRecorder.start(AUDIO_CHUNK_MS);
}

async function startSharing() {
  shareBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 60, max: 60 },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
      },
      audio: true,
    });

    previewVideo.srcObject = stream;
    await previewVideo.play();

    startFrameLoop(previewVideo);
    startAudioCapture(stream);

    setStatus('sharing active', true);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'started' }));
    }

    stream.getVideoTracks()[0].addEventListener('ended', stopSharing);
  } catch (err) {
    console.warn(err);
    setStatus('sharing cancelled or denied', false);
    shareBtn.disabled = false;
  }
}

function stopSharing() {
  clearInterval(frameTimer);
  frameTimer = null;
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
  setStatus('sharing stopped', false);
  shareBtn.disabled = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'capture_stopped' }));
  }
}

if (!sessionId) {
  setStatus('missing sessionId', false);
} else {
  connectWs();
  setTimeout(() => startSharing(), 100);
}
