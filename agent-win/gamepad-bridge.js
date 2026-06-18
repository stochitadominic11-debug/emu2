// Translates browser Gamepad API state into a virtual Xbox 360 controller.
// Requires ViGEmBus installed in the Windows VM.

let client = null;
let controller = null;
let available = false;

const BUTTON_MAP = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LEFT_SHOULDER',
  5: 'RIGHT_SHOULDER',
  8: 'BACK',
  9: 'START',
  10: 'LEFT_THUMB',
  11: 'RIGHT_THUMB',
};

function init() {
  try {
    // eslint-disable-next-line global-require
    const ViGEmClient = require('vigemclient');
    client = new ViGEmClient();
    const connectErr = client.connect();
    if (connectErr) throw connectErr;

    controller = client.createX360Controller();
    const controllerErr = controller.connect();
    if (controllerErr) throw controllerErr;

    controller.updateMode = 'manual';
    available = true;
    console.log('[gamepad] ViGEmBus OK: virtual Xbox 360 controller connected.');
  } catch (err) {
    available = false;
    console.warn(
      '[gamepad] ViGEmBus/vigemclient unavailable. Remote controller disabled. ' +
        'Install ViGEmBus and run npm install in agent-win. Detail: ' + err.message
    );
  }
}

function safeCall(fn) {
  try {
    fn();
  } catch (err) {
    console.warn('[gamepad] input error:', err.message);
  }
}

function numberOr(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function setButton(name, pressed) {
  const button = controller.button && controller.button[name];
  if (!button || typeof button.setValue !== 'function') {
    throw new Error(`ViGEm button not found: ${name}`);
  }
  button.setValue(!!pressed);
}

function setAxis(name, value) {
  const axis = controller.axis && controller.axis[name];
  if (!axis || typeof axis.setValue !== 'function') {
    throw new Error(`ViGEm axis not found: ${name}`);
  }
  axis.setValue(numberOr(value));
}

function applyState(gamepadState) {
  if (!available || !controller || !gamepadState || typeof gamepadState !== 'object') return;

  const buttons = Array.isArray(gamepadState.buttons) ? gamepadState.buttons : [];
  const axes = Array.isArray(gamepadState.axes) ? gamepadState.axes : [];

  for (const [indexStr, buttonName] of Object.entries(BUTTON_MAP)) {
    const index = Number(indexStr);
    safeCall(() => setButton(buttonName, numberOr(buttons[index]) > 0.5));
  }

  safeCall(() => setAxis('dpadHorz', numberOr(buttons[15]) - numberOr(buttons[14])));
  safeCall(() => setAxis('dpadVert', numberOr(buttons[12]) - numberOr(buttons[13])));

  safeCall(() => setAxis('leftTrigger', numberOr(buttons[6])));
  safeCall(() => setAxis('rightTrigger', numberOr(buttons[7])));

  const [lx = 0, ly = 0, rx = 0, ry = 0] = axes;
  safeCall(() => setAxis('leftX', lx));
  safeCall(() => setAxis('leftY', -ly));
  safeCall(() => setAxis('rightX', rx));
  safeCall(() => setAxis('rightY', -ry));

  safeCall(() => controller.update());
}

function isAvailable() {
  return available;
}

module.exports = { init, applyState, isAvailable };
