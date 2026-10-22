// Loading screen, pause menu, crash report and replay controls.
import { h } from './dom.js';
import { KT, FT } from '../core/units.js';

export class Loading {
  constructor(root) {
    this.bar = h('div');
    this.steps = h('div', { class: 'steps' });
    this.title = h('h2', {}, 'Preparing flight');
    this.el = h('div', { class: 'overlay', id: 'loading' }, h('div', { class: 'box' }, this.title, h('div', { class: 'note' }, 'Streaming terrain, building airport and scenery…'), h('div', { class: 'progress' }, this.bar), this.steps));
    root.append(this.el);
  }
  step(msg, frac, cls = 'ok') { this.steps.append(h('div', { class: cls }, `${cls === 'warn' ? '⚠' : '✓'} ${msg}`)); this.steps.scrollTop = 1e6; if (frac != null) this.progress(frac); }
  progress(f) { this.bar.style.width = `${Math.round(Math.min(1, f) * 100)}%`; }
  remove() { this.el.remove(); }
}

export function pauseMenu(root, { resume, restart, menu }) {
  const el = h('div', { class: 'overlay', id: 'pause' }, h('div', { class: 'box' }, h('h2', {}, 'Paused'),
    h('div', { class: 'note' }, 'Simulation is frozen. Press P or Esc to resume.'),
    h('div', { class: 'actions' }, h('button', { class: 'primary', onclick: resume }, 'Resume'), h('button', { onclick: restart }, 'Restart flight'), h('button', { onclick: menu }, 'Return to menu'))));
  root.append(el);
  return el;
}

/** Post-crash report with telemetry derived from the damage model and flight recorder. */
export function crashReport(root, ac, rec, { replay, restart, menu }) {
  const d = ac.damage, p = rec.peaks(6), td = ac.touchdown;
  const title = d.ditched && !d.destroyed ? 'Ditched' : d.destroyed ? 'Aircraft destroyed' : 'Flight ended';
  const lastImpacts = d.events.filter((e) => e.type === 'damage' || e.type === 'detached' || e.type === 'destroyed').slice(-6);
  const el = h('div', { class: 'overlay', id: 'crash' }, h('div', { class: 'box' },
    h('h2', {}, title), h('div', { class: 'note' }, d.destroyedReason || (d.ditched ? 'The aircraft came to rest on the water.' : '')),
    h('div', { class: 'telemetry' },
      h('div', {}, h('span', {}, 'Max IAS (last 6 s): '), `${Math.round(p.maxIas / KT)} kt`),
      h('div', {}, h('span', {}, 'Max sink rate: '), `${Math.round(-p.minVs / FT * 60)} fpm (${(-p.minVs).toFixed(1)} m/s)`),
      h('div', {}, h('span', {}, 'Peak load factor: '), `${p.maxNz.toFixed(1)} g / ${p.minNz.toFixed(1)} g`),
      h('div', {}, h('span', {}, 'Last ground contact: '), td ? `${td.wheel} on ${td.surface}, ${td.sinkRate.toFixed(1)} m/s` : '—'),
      h('div', {}, h('span', {}, 'Detached: '), Object.keys(d.detached).filter((k) => d.detached[k]).join(', ') || 'none'),
      h('div', {}, h('span', {}, 'Fire: '), d.fire ? 'yes' : 'no')),
    h('div', { class: 'note', style: { marginTop: '10px' } }, 'Component health: ' + Object.entries(d.health).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')),
    h('div', { class: 'steps', style: { marginTop: '8px' } }, ...lastImpacts.map((e) => h('div', { class: 'warn' }, `${e.t}s ${e.type} ${e.component}: ${e.detail}`))),
    h('div', { class: 'actions' }, h('button', { onclick: replay, id: 'btn-replay' }, '▶ Crash replay'), h('button', { class: 'primary', onclick: restart, id: 'btn-restart' }, 'Restart flight'), h('button', { onclick: menu, id: 'btn-menu' }, 'Return to menu'))));
  root.append(el);
  return el;
}

export function replayBar(root, { stop }) {
  const t = h('span', { class: 'note' }, '');
  const el = h('div', { class: 'replaybar' }, h('b', {}, 'REPLAY'), t, h('button', { onclick: stop }, 'Close replay'));
  root.append(el);
  return { el, setTime: (a, b) => (t.textContent = `${a.toFixed(1)} / ${b.toFixed(1)} s · drag to orbit, scroll to zoom`) };
}
