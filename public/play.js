// public/play.js — pagina dell'amico: vede lo schermo e manda l'input del joystick

const params = new URLSearchParams(location.search);
const sessionId = params.get('session');

const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d');
const audioEl = document.getElementById('audio');
const connDot = document.getElementById('conn-dot');
const connText = document.getElementById('conn-text');
const padDot = document.getElementById('pad-dot');
const padText = document.getElementById('pad-text');
const startOverlay = document.getElementById('start-overlay');
const startTitle = document.getElementById('start-title');
const startSubtitle = document.getElementById('start-subtitle');
const startBtn = document.getElementById('start-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const sensRange = document.getElementById('sens-range');
const sensValue = document.getElementById('sens-value');

const GAMEPAD_SEND_HZ_MS = 50; // 20 volte al secondo basta per un controller

// Sensibilità della visuale (levetta destra). Salvata nel browser, così resta
// uguale ogni volta che si rientra nel sito senza doverla ritoccare.
const SENS_KEY = 'rpw_lookSensitivity';
const SENS_MIN = 5;
const SENS_MAX = 80;
const SENS_DEFAULT = 30;

function clampSens(v) {
  if (!Number.isFinite(v)) return SENS_DEFAULT;
  return Math.min(SENS_MAX, Math.max(SENS_MIN, Math.round(v)));
}

let lookSensitivity = clampSens(parseFloat(localStorage.getItem(SENS_KEY)));
let sessionEnded = false; // dopo la fine partita non mandiamo più input (sicurezza)

let ws = null;
let mediaSource = null;
let sourceBuffer = null;
const audioQueue = [];
let gamepadTimer = null;

function setConn(text, live) {
  connText.textContent = text;
  connDot.classList.toggle('live', !!live);
}

function setPad(text, live) {
  padText.textContent = text;
  padDot.classList.toggle('live', !!live);
}

function showOverlay(title, subtitle, showButton) {
  startTitle.textContent = title;
  startSubtitle.textContent = subtitle;
  startBtn.style.display = showButton ? 'inline-block' : 'none';
  startOverlay.style.display = 'flex';
}

function hideOverlay() {
  startOverlay.style.display = 'none';
}

// ---------- video: ogni frame JPEG arriva già pronto, lo disegniamo ----------

function drawFrame(arrayBuffer) {
  const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
  createImageBitmap(blob)
    .then((bitmap) => {
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    })
    .catch(() => {});
}

// ---------- audio: chunk webm/opus accodati in un MediaSource ----------

function initAudio() {
  if (!window.MediaSource || !MediaSource.isTypeSupported('audio/webm; codecs="opus"')) {
    console.warn('MediaSource/opus non supportato qui: niente audio.');
    return;
  }
  mediaSource = new MediaSource();
  audioEl.src = URL.createObjectURL(mediaSource);
  mediaSource.addEventListener('sourceopen', () => {
    sourceBuffer = mediaSource.addSourceBuffer('audio/webm; codecs="opus"');
    sourceBuffer.addEventListener('updateend', appendNextAudioChunk);
  });
}

function appendNextAudioChunk() {
  if (!sourceBuffer || sourceBuffer.updating || audioQueue.length === 0) return;
  try {
    sourceBuffer.appendBuffer(audioQueue.shift());
  } catch {
    /* buffer pieno o stato strano: scartiamo il chunk e andiamo avanti */
  }
}

function handleAudioChunk(arrayBuffer) {
  audioQueue.push(arrayBuffer);
  if (audioQueue.length > 40) audioQueue.shift(); // non accumulare ritardo all'infinito
  appendNextAudioChunk();
}

// ---------- joystick: leggiamo la Gamepad API e mandiamo lo stato ----------

function readActiveGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const pad of pads) {
    if (pad) return pad;
  }
  return null;
}

function sendGamepadState() {
  if (sessionEnded) return;
  const pad = readActiveGamepad();
  if (!pad) {
    setPad('nessun controller', false);
    return;
  }
  setPad(`controller: ${pad.id.slice(0, 24)}`, true);
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: 'input',
      gamepad: {
        buttons: pad.buttons.map((b) => (b.pressed ? 1 : b.value || 0)),
        axes: pad.axes,
      },
      lookSensitivity, // scelta dallo slider, applicata dal capture-agent
    })
  );
}

window.addEventListener('gamepadconnected', (e) => {
  setPad(`controller: ${e.gamepad.id.slice(0, 24)}`, true);
});
window.addEventListener('gamepaddisconnected', () => {
  setPad('nessun controller', false);
});

// ---------- touch/mouse: il dito sul video = il mouse nel gioco ----------
//
// Tocco e rilascio sullo stesso punto = un click. Trascinare il dito = muovere
// il mouse tenendo premuto. Le coordinate le mandiamo "normalizzate" (0..1)
// rispetto all'immagine mostrata: è il capture-agent, che conosce la finestra
// del gioco, a trasformarle nel pixel reale dove cliccare.

let pointerIsDown = false;
let lastMoveSentAt = 0;
const MOUSE_MOVE_MIN_MS = 40; // non intasare il canale mentre si trascina

function sendMouse(action, ev) {
  if (sessionEnded) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const x = (ev.clientX - rect.left) / rect.width;
  const y = (ev.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return; // tocco fuori dall'immagine

  ws.send(JSON.stringify({ type: 'mouse', action, x, y }));
}

function initTouchMouse() {
  canvas.addEventListener('pointerdown', (ev) => {
    pointerIsDown = true;
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(ev.pointerId); } catch {}
    }
    sendMouse('down', ev);
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!pointerIsDown) return;
    const now = performance.now();
    if (now - lastMoveSentAt < MOUSE_MOVE_MIN_MS) return;
    lastMoveSentAt = now;
    sendMouse('move', ev);
    ev.preventDefault();
  });

  function endPointer(ev) {
    if (!pointerIsDown) return;
    pointerIsDown = false;
    sendMouse('up', ev);
    ev.preventDefault();
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
}

// ---------- impostazioni: calibrazione sensibilità visuale ----------

function initSettings() {
  sensRange.min = SENS_MIN;
  sensRange.max = SENS_MAX;
  sensRange.value = lookSensitivity;
  sensValue.textContent = lookSensitivity;

  sensRange.addEventListener('input', () => {
    lookSensitivity = clampSens(parseFloat(sensRange.value));
    sensValue.textContent = lookSensitivity;
    localStorage.setItem(SENS_KEY, String(lookSensitivity)); // resta salvata
  });

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('show');
  });
}

// ---------- WebSocket ----------

function connectWs() {
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProto}//${location.host}/ws/view?sessionId=${sessionId}`);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('open', () => {
    setConn('connesso, aspetto il video…', true);
  });

  ws.addEventListener('message', (ev) => {
    if (typeof ev.data === 'string') {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'started') {
        setConn('in diretta', true);
      } else if (msg.type === 'capture_disconnected') {
        setConn('host disconnesso, aspetto…', false);
      } else if (msg.type === 'session_ended') {
        setConn('sessione terminata', false);
        showOverlay('Sessione terminata', msg.reason || '', false);
        // sicurezza: stop a ogni input verso il PC host dopo la fine partita.
        sessionEnded = true;
        clearInterval(gamepadTimer);
        clearInterval(preStartPadTimer);
      }
      return;
    }

    // messaggio binario: primo byte = tipo
    const buf = ev.data;
    const view = new Uint8Array(buf);
    const type = view[0];
    const payload = buf.slice(1);
    if (type === 1) {
      setConn('in diretta', true);
      drawFrame(payload);
    } else if (type === 2) {
      handleAudioChunk(payload);
    }
  });

  ws.addEventListener('close', () => setConn('disconnesso', false));
  ws.addEventListener('error', () => setConn('errore di connessione', false));
}

function start() {
  hideOverlay();
  clearInterval(preStartPadTimer);
  audioEl.play().catch(() => {});
  gamepadTimer = setInterval(sendGamepadState, GAMEPAD_SEND_HZ_MS);
}

// Mentre è visibile "Pronto a giocare?", qualsiasi tasto del controller
// premuto equivale a cliccare "Inizia" — utile su dispositivi dove
// muovere il focus con tastiera/mouse non è comodo (es. da telefono/Xbox).
let preStartPadTimer = null;
function watchForAnyButtonPress() {
  preStartPadTimer = setInterval(() => {
    const pad = readActiveGamepad();
    if (pad && pad.buttons.some((b) => b.pressed || b.value > 0.5)) {
      start();
    }
  }, 100);
}

if (!sessionId) {
  showOverlay('Link non valido', 'Manca il codice di sessione nell\'URL.', false);
} else {
  initAudio();
  connectWs();
  initTouchMouse();
  initSettings();
  startBtn.addEventListener('click', start);
  watchForAnyButtonPress();
}
