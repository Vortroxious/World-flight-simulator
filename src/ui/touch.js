// On-screen touch controls for phones and tablets: virtual stick (pitch/roll), throttle lever,
// rudder, flaps, brakes, trim, view and pause. Feeds the same Input axes and command layer as the keyboard.
import { h } from './dom.js';
import { clamp } from '../core/math.js';

export const isTouchDevice = () => (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;

export class TouchControls {
  /**
   * @param {HTMLElement} root @param {import('../input/input.js').Input} input
   * @param {object} cmd command layer @param {object} actions {view, instruments, pause, hud}
   */
  constructor(root, input, cmd, actions, opts = {}) {
    this.input = input; this.cmd = cmd; this.actions = actions;
    this.invertPitch = !!opts.invertPitch;
    this.held = { brake: false, trimUp: false, trimDown: false };
    this.el = h('div', { class: 'touch', id: 'touch-controls' });
    root.append(this.el);
    this.el.append(h('div', { class: 'rotate-hint' }, 'Turn your device sideways (landscape) for the best view.'));
    this.buildStick();
    this.buildThrottle();
    this.buildButtons();
  }

  /** Hold-to-act button: fn(true) on press, fn(false) on release. */
  holdButton(label, title, fn, cls = '') {
    const b = h('button', { class: 'tbtn ' + cls, 'aria-label': title, title }, label);
    const on = (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); b.classList.add('on'); fn(true); };
    const off = (e) => { e.preventDefault(); b.classList.remove('on'); fn(false); };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
    return b;
  }
  tapButton(label, title, fn, cls = '') {
    const b = h('button', { class: 'tbtn ' + cls, 'aria-label': title, title }, label);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); b.classList.add('on'); setTimeout(() => b.classList.remove('on'), 150); });
    return b;
  }

  buildStick() {
    const knob = h('div', { class: 'tstick-knob' });
    const base = h('div', { class: 'tstick', 'aria-label': 'Flight stick: drag to pitch and roll' }, h('div', { class: 'tstick-cross' }), knob);
    let id = null, cx = 0, cy = 0, R = 1;
    const move = (e) => {
      if (e.pointerId !== id) return;
      const dx = e.clientX - cx, dy = e.clientY - cy;
      const l = Math.hypot(dx, dy), k = l > R ? R / l : 1;
      const x = dx * k, y = dy * k;
      knob.style.transform = `translate(${x}px, ${y}px)`;
      // Expo curve for finer control near centre.
      const ex = (v) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
      this.input.touch.aileron = ex(clamp(x / R, -1, 1));
      this.input.touch.elevator = ex(clamp((this.invertPitch ? -y : y) / R, -1, 1)); // drag down (towards you) = pull = nose up
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; knob.style.transform = '';
      this.input.touch.active = false; this.input.touch.aileron = 0; this.input.touch.elevator = 0;
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = base.getBoundingClientRect();
      id = e.pointerId; cx = r.left + r.width / 2; cy = r.top + r.height / 2; R = r.width * 0.38;
      base.setPointerCapture?.(e.pointerId);
      this.input.touch.active = true;
      move(e);
    });
    base.addEventListener('pointermove', move);
    base.addEventListener('pointerup', end); base.addEventListener('pointercancel', end);
    const rudder = h('div', { class: 'trudder' },
      this.holdButton('◀', 'Rudder left (hold)', (v) => { this.input.touch.rudder = v ? -1 : 0; }),
      h('span', {}, 'RUDDER'),
      this.holdButton('▶', 'Rudder right (hold)', (v) => { this.input.touch.rudder = v ? 1 : 0; }));
    this.el.append(h('div', { class: 'tleft' }, base, rudder));
  }

  buildThrottle() {
    const fill = h('div', { class: 'tthr-fill' });
    const handle = h('div', { class: 'tthr-handle' });
    const label = h('div', { class: 'tthr-label' }, 'THR');
    const track = h('div', { class: 'tthr', 'aria-label': 'Throttle: drag up for power' }, fill, handle);
    let id = null;
    const set = (e) => {
      const r = track.getBoundingClientRect();
      this.cmd.setThrottle(clamp(1 - (e.clientY - r.top) / r.height, 0, 1));
    };
    track.addEventListener('pointerdown', (e) => { e.preventDefault(); id = e.pointerId; track.setPointerCapture?.(id); set(e); });
    track.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId === id) id = null; };
    track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
    this.thr = { fill, handle, label };
    this.el.append(h('div', { class: 'tright' }, label, track,
      h('div', { class: 'trow' },
        this.holdButton('BRK', 'Wheel brakes (hold)', (v) => { this.held.brake = v; }, 'warn'),
        this.tapButton('PARK', 'Parking brake on/off', () => this.cmd.toggleParkingBrake()))));
  }

  buildButtons() {
    this.flapLabel = h('span', { class: 'tval' }, '0°');
    this.parkEl = null;
    const grid = h('div', { class: 'tbuttons' },
      this.tapButton('FLAP ▲', 'Flaps up one notch', () => this.cmd.flaps(-1)),
      this.tapButton('FLAP ▼', 'Flaps down one notch', () => this.cmd.flaps(1)),
      this.holdButton('TRIM ▲', 'Trim nose up (hold)', (v) => { this.held.trimUp = v; }),
      this.holdButton('TRIM ▼', 'Trim nose down (hold)', (v) => { this.held.trimDown = v; }),
      this.tapButton('VIEW', 'Cycle cockpit / chase / orbit / tower views', () => this.actions.view()),
      this.tapButton('PANEL', 'Zoom on the instrument panel', () => this.actions.instruments()),
      this.tapButton('HUD', 'Show or hide the flight data panel', () => this.actions.hud()),
      this.tapButton('❚❚', 'Pause / menu', () => this.actions.pause()));
    this.el.append(h('div', { class: 'ttop' }, grid, h('div', { class: 'tflaps' }, 'FLAPS ', this.flapLabel)));
  }

  /** Per-frame: continuous trim, brake state, throttle readout. */
  update(dt, ac) {
    if (this.held.trimUp) this.cmd.trim(0.3 * dt);
    if (this.held.trimDown) this.cmd.trim(-0.3 * dt);
    this.input.touchBrake = this.held.brake ? 1 : 0;
    const t = ac.controls.throttle;
    this.thr.fill.style.height = `${t * 100}%`;
    this.thr.handle.style.bottom = `calc(${t * 100}% - 14px)`;
    this.thr.label.textContent = `THR ${Math.round(t * 100)}%`;
    this.flapLabel.textContent = `${Math.round(ac.flapDeg)}°${ac.controls.parkingBrake ? ' · PARK' : ''}`;
  }

  setVisible(v) { this.el.hidden = !v; }
  remove() { this.el.remove(); this.input.touch.active = false; }
}
