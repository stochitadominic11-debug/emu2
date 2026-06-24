// agent-win/gamepad-bridge.js
//
// Traduce lo stato del controller letto dal browser dell'amico (Gamepad API)
// in input per un Xbox 360 Controller VIRTUALE, cosi il gioco nella VM lo
// vede come un controller vero e proprio collegato.
//
// Richiede il driver ViGEmBus installato nella VM (gratuito, open source,
// lo stesso usato da Moonlight/Sunshine):
//   https://github.com/ViGEm/ViGEmBus/releases
//
// Se il driver o il pacchetto npm "vigemclient" non sono disponibili,
// questo modulo si disattiva da solo: il resto del sistema (video/audio/
// avvio gioco) continua a funzionare normalmente, semplicemente senza
// joystick virtuale.
//
// NOTA: i nomi esatti dei metodi di "vigemclient" possono cambiare da
// versione a versione. Se qualcosa qui sotto non corrisponde più al
// pacchetto installato, controlla la pagina npm/GitHub di "vigemclient"
// e aggiusta la mappatura: la logica (quale indice del Gamepad API va
// su quale pulsante/asse) resta valida.

let client = null;
let controller = null;
let available = false;

// Indici "standard" della Gamepad API -> nome pulsante XInput
const BUTTON_MAP = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LeftShoulder',
  5: 'RightShoulder',
  8: 'Back',
  9: 'Start',
  10: 'LeftThumb',
  11: 'RightThumb',
  12: 'Up',
  13: 'Down',
  14: 'Left',
  15: 'Right',
};

function init() {
  try {
    // eslint-disable-next-line global-require
    const ViGEmClient = require('vigemclient');
    client = new ViGEmClient();
    client.connect();
    controller = client.createX360Controller();
    controller.connect();
    available = true;
    console.log('[gamepad] ViGEmBus trovato: controller virtuale creato e connesso.');
  } catch (err) {
    available = false;
    console.warn(
      '[gamepad] ViGEmBus/vigemclient non disponibili. Il joystick remoto non funzionerà ' +
        '(ma video, audio e avvio gioco sì). Installa ViGEmBus e fai "npm install" in agent-win. ' +
        'Dettaglio errore: ' + err.message
    );
  }
}

function safeCall(fn) {
  try {
    fn();
  } catch (err) {
    // Non blocchiamo mai il resto dell'agent per un singolo input che fallisce.
    console.warn('[gamepad] errore mentre impostavo un input:', err.message);
  }
}

// gamepadState arriva così com'è dalla Gamepad API del browser:
//  buttons: array di valori 0..1 (1 = premuto a fondo)
//  axes: [leftX, leftY, rightX, rightY] ognuno -1..1
function applyState(gamepadState) {
  if (!available || !controller) return;
  const { buttons = [], axes = [] } = gamepadState;

  for (const [indexStr, buttonName] of Object.entries(BUTTON_MAP)) {
    const index = Number(indexStr);
    const pressed = (buttons[index] || 0) > 0.5;
    safeCall(() => controller.button[buttonName].setValue(pressed));
  }

  // I grilletti (indici 6 e 7) sono analogici: li mandiamo come assi, non come on/off.
  const leftTrigger = buttons[6] || 0;
  const rightTrigger = buttons[7] || 0;
  safeCall(() => controller.axis.leftTrigger.setValue(leftTrigger));
  safeCall(() => controller.axis.rightTrigger.setValue(rightTrigger));

  const [lx = 0, ly = 0, rx = 0, ry = 0] = axes;
  safeCall(() => controller.axis.leftX.setValue(lx));
  // Nota: l'asse Y della Gamepad API ha "su" negativo; se nel gioco i
  // movimenti su/giù risultano invertiti, togli il segno meno qui sotto.
  safeCall(() => controller.axis.leftY.setValue(-ly));
  safeCall(() => controller.axis.rightX.setValue(rx));
  safeCall(() => controller.axis.rightY.setValue(-ry));

  safeCall(() => controller.update());
}

function isAvailable() {
  return available;
}

module.exports = { init, applyState, isAvailable };
