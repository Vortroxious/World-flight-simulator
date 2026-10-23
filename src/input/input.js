// Keyboard, mouse-yoke and gamepad input. Produces smoothed primary flight-control positions and
// dispatches discrete commands. Bindings are data-driven and persisted in localStorage.
import { clamp, moveToward } from '../core/math.js';

export const DEFAULT_BINDINGS = {
  pitchDown: ['ArrowUp', 'KeyW'], pitchUp: ['ArrowDown', 'KeyS'], rollLeft: ['ArrowLeft', 'KeyA'], rollRight: ['ArrowRight', 'KeyD'],
  yawLeft: ['KeyZ', 'Numpad0'], yawRight: ['KeyX', 'NumpadEnter'],
  throttleUp: ['PageUp', 'F3', 'Equal'], throttleDown: ['PageDown', 'F2', 'Minus'], throttleFull: ['F4'], throttleCut: ['F1'],
  mixtureRich: ['Shift+KeyM'], mixtureLean: ['KeyM'],
  flapsUp: ['F6', 'BracketLeft'], flapsDown: ['F7', 'BracketRight'], flapsRetract: ['F5'], flapsFull: ['F8'],
  trimUp: ['End', 'Numpad1'], trimDown: ['Home', 'Numpad7'],
  brakes: ['Period', 'KeyB'], parkingBrake: ['Ctrl+Period', 'Shift+KeyB'],
  magnetosUp: ['Shift+KeyE'], magnetosDown: ['Ctrl+KeyE'], starter: ['KeyE'],
  view: ['KeyV'], cockpitView: ['KeyC'], instrumentView: ['KeyI'], hud: ['KeyH'], debug: ['Backquote', 'F9'], pause: ['KeyP'], restart: ['Ctrl+KeyR'],
  menu: ['Escape'], mouseYoke: ['KeyY'], lookBack: ['Numpad2'], resetView: ['Numpad5'], sound: ['Ctrl+KeyS'], dgSync: ['Shift+KeyD'], directTo: ['Shift+KeyG'],
  timeAccel: ['KeyT'], landingLight: ['Ctrl+KeyL'], strobe: ['KeyO'], master: ['Ctrl+KeyM'],
  // Transport / jet controls
  gear: ['KeyG'], speedbrake: ['Slash'], armSpoilers: ['Shift+Slash'], reverse: ['KeyR'], propUp: ['Shift+PageUp'], propDown: ['Shift+PageDown'],
  autoStart: ['Ctrl+Shift+KeyE'], masterReset: ['Shift+KeyQ'],
  // Autopilot / autothrottle (Shift+key; Ctrl+letter combinations are reserved by browsers)
  apToggle: ['Shift+KeyZ'], atToggle: ['Shift+KeyR'], apHdg: ['Shift+KeyH'], apNav: ['Shift+KeyN'], apApp: ['Shift+KeyA'], apAlt: ['Shift+KeyL'], apVs: ['Shift+KeyV'], apFlc: ['Shift+KeyF'],
  hdgUp: ['Shift+ArrowRight'], hdgDown: ['Shift+ArrowLeft'], altUp: ['Shift+ArrowUp'], altDown: ['Shift+ArrowDown'], spdUp: ['Ctrl+ArrowUp'], spdDown: ['Ctrl+ArrowDown'], vsUp: ['Ctrl+Shift+ArrowUp'], vsDown: ['Ctrl+Shift+ArrowDown'],
};

const keyId = (e) => `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey ? 'Shift+' : ''}${e.altKey ? 'Alt+' : ''}${e.code}`;

export class Input {
  constructor(el, cfg = {}) {
    this.el = el;
    this.bindings = { ...DEFAULT_BINDINGS, ...(cfg.bindings || {}) };
    this.sensitivity = cfg.sensitivity ?? 1;
    this.held = new Set();
    this.listeners = {};
    this.axes = { elevator: 0, aileron: 0, rudder: 0 };
    this.mouseYoke = false; this.mouse = { x: 0, y: 0 };
    this.gamepad = { connected: false, deadzone: 0.08, invertPitch: false };
    this.touch = { active: false, elevator: 0, aileron: 0, rudder: 0 }; // fed by on-screen touch controls
    this.touchBrake = 0;
    this.enabled = true;
    this.lookup = new Map();
    this.rebuild();
    this._kd = (e) => this.onKey(e, true); this._ku = (e) => this.onKey(e, false);
    window.addEventListener('keydown', this._kd); window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', () => this.held.clear());
    this._mm = (e) => { const r = el.getBoundingClientRect(); this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1; this.mouse.y = ((e.clientY - r.top) / r.height) * 2 - 1; };
    el.addEventListener('mousemove', this._mm);
    window.addEventListener('gamepadconnected', () => { this.gamepad.connected = true; this.emit('gamepad', true); });
    window.addEventListener('gamepaddisconnected', () => { this.gamepad.connected = false; this.emit('gamepad', false); });
  }

  rebuild() {
    this.lookup.clear();
    for (const [action, keys] of Object.entries(this.bindings)) for (const k of keys) this.lookup.set(k, { action });
  }
  on(action, fn) { (this.listeners[action] ||= []).push(fn); }
  emit(action, v) { for (const f of this.listeners[action] || []) f(v); }

  onKey(e, down) {
    if (!this.enabled || e.target?.tagName === 'INPUT' || e.target?.tagName === 'SELECT') return;
    const id = keyId(e);
    let b = this.lookup.get(id);
    if (!b && !down) { // release: match ignoring modifiers
      for (const [k, v] of this.lookup) if (k.endsWith(e.code)) { this.held.delete(v.action); }
      return;
    }
    if (!b) b = this.lookup.get(e.code);
    if (!b) return;
    e.preventDefault();
    if (down) {
      if (!this.held.has(b.action)) { this.held.add(b.action); this.emit(b.action, true); }
    } else { this.held.delete(b.action); this.emit(b.action + ':up', false); }
  }

  isHeld(a) { return this.held.has(a); }

  /** Integrate keyboard/mouse/gamepad into control positions. Returns axes in -1..1. */
  update(dt, ac) {
    const rate = (ac?.cfg.controls.keyboardRate ?? 2) * this.sensitivity, ret = ac?.cfg.controls.keyboardReturnRate ?? 3;
    const kb = (pos, neg, cur) => {
      if (this.isHeld(pos) && !this.isHeld(neg)) return moveToward(cur, 1, rate * dt * (cur < 0 ? 2 : 1));
      if (this.isHeld(neg) && !this.isHeld(pos)) return moveToward(cur, -1, rate * dt * (cur > 0 ? 2 : 1));
      return moveToward(cur, 0, ret * dt);
    };
    let usedGamepad = false;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    if (gp) {
      const dz = (v) => (Math.abs(v) < this.gamepad.deadzone ? 0 : (v - Math.sign(v) * this.gamepad.deadzone) / (1 - this.gamepad.deadzone));
      const lx = dz(gp.axes[0] || 0), ly = dz(gp.axes[1] || 0), rx = dz(gp.axes[2] || 0);
      if (Math.abs(lx) + Math.abs(ly) + Math.abs(rx) > 0.01) {
        usedGamepad = true;
        this.axes.aileron = lx * this.sensitivity;
        this.axes.elevator = (this.gamepad.invertPitch ? -ly : ly) * this.sensitivity;
        this.axes.rudder = rx;
      }
      const rt = gp.buttons[7]?.value ?? 0, lt = gp.buttons[6]?.value ?? 0;
      if (rt > 0.05) this.emit('throttleAxis', rt * dt);
      if (lt > 0.05) this.emit('throttleAxis', -lt * dt);
      this.gpBrake = gp.buttons[0]?.pressed ? 1 : 0;
    }
    if (!usedGamepad && this.touch.active) {
      this.axes.aileron = this.touch.aileron * this.sensitivity;
      this.axes.elevator = this.touch.elevator * this.sensitivity;
    }
    if (!usedGamepad && !this.touch.active) {
      if (this.mouseYoke) {
        this.axes.aileron = clamp(this.mouse.x * 1.3, -1, 1) * this.sensitivity;
        this.axes.elevator = clamp(this.mouse.y * 1.3, -1, 1) * this.sensitivity;
      } else {
        this.axes.elevator = kb('pitchUp', 'pitchDown', this.axes.elevator);
        this.axes.aileron = kb('rollRight', 'rollLeft', this.axes.aileron);
      }
      if (!this.touch.rudder) this.axes.rudder = kb('yawRight', 'yawLeft', this.axes.rudder);
    }
    if (this.touch.rudder) this.axes.rudder = moveToward(this.axes.rudder, this.touch.rudder, rate * dt);
    else if (this.touch.active && !usedGamepad) this.axes.rudder = kb('yawRight', 'yawLeft', this.axes.rudder);
    return this.axes;
  }

  dispose() { window.removeEventListener('keydown', this._kd); window.removeEventListener('keyup', this._ku); this.el.removeEventListener('mousemove', this._mm); }
}
