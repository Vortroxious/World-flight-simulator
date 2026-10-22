// In-flight HUD, warning banners, toasts, tooltip and view tag.
import { h } from './dom.js';
import { KT, FT } from '../core/units.js';
import { MAG_LABEL } from '../sim/commands.js';

export class Hud {
  constructor(root) {
    this.el = h('div', { class: 'hud', id: 'hud' });
    this.warn = h('div', { class: 'warnings', id: 'warnings' });
    this.toastEl = h('div', { class: 'toast', style: { opacity: 0 } });
    this.tooltip = h('div', { class: 'tooltip' });
    this.viewTag = h('div', { class: 'viewtag' });
    root.append(this.el, this.warn, this.toastEl, this.tooltip, this.viewTag);
    this.visible = true; this.t = 0;
  }
  setVisible(v) { this.visible = v; this.el.style.display = v ? '' : 'none'; }
  toast(msg, ms = 1800) { this.toastEl.textContent = msg; this.toastEl.style.opacity = 1; clearTimeout(this._tt); this._tt = setTimeout(() => (this.toastEl.style.opacity = 0), ms); }
  remove() { for (const e of [this.el, this.warn, this.toastEl, this.tooltip, this.viewTag]) e.remove(); }

  update(dt, ac, extra) {
    this.t += dt;
    const w = ac.warnings || {};
    const warns = [];
    if (w.stall) warns.push(['STALL', 'r']);
    if (w.overspeed) warns.push(['OVERSPEED', 'r']);
    if (w.flapOverspeed) warns.push(['FLAP SPEED', 'a']);
    if (w.overG) warns.push([`G ${ac.nz.toFixed(1)}`, 'r']);
    if (w.fire) warns.push(['FIRE', 'r']);
    if (w.oilPress && ac.engine.running) warns.push(['OIL PRESS', 'r']);
    if (w.lowVolts) warns.push(['LOW VOLTS', 'a']);
    if (ac.controls.parkingBrake && ac.engine.running && ac.controls.throttle > 0.3) warns.push(['PARKING BRAKE', 'a']);
    if (extra.paused) warns.push(['PAUSED', 'a']);
    const key = warns.map((x) => x[0]).join('|');
    if (key !== this._wk) { this._wk = key; this.warn.replaceChildren(...warns.map(([t, c]) => h('div', { class: c }, t))); }
    this.viewTag.textContent = `${extra.view}${extra.timeAccel > 1 ? ` · time ×${extra.timeAccel}` : ''}${extra.mouseYoke ? ' · mouse yoke' : ''} · H hud · \` debug · Esc menu`;
    if (!this.visible || this.t < 0.1) return;
    this.t = 0;
    const s = ac.snapshot();
    const dmg = ac.damage.summary();
    const worst = dmg.worst.filter(([, v]) => v < 0.98).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(', ');
    const wind = Math.hypot(ac.windNed[0], ac.windNed[1]);
    const windFrom = (Math.atan2(-ac.windNed[1], -ac.windNed[0]) * 180 / Math.PI + 360) % 360;
    const nav = extra.nav?.target;
    this.el.innerHTML = `
      <div class="big"><div><b>${Math.round(s.ias / KT)}</b><span>IAS KT</span></div><div><b>${Math.round(s.alt / FT).toLocaleString()}</b><span>ALT FT</span></div><div><b>${String(Math.round(s.headingMag) % 360).padStart(3, '0')}</b><span>HDG °M</span></div></div>
      <div class="line"><i>VS</i><span>${Math.round(s.vs / FT * 60)} fpm</span><i>GS</i><span>${Math.round(s.gs / KT)} kt</span><i>AGL</i><span>${Math.round(s.agl / FT)} ft</span></div>
      <div class="line ext"><i>RPM</i><span>${Math.round(s.rpm)}</span><i>THR</i><span>${Math.round(ac.controls.throttle * 100)}%</span><i>MIX</i><span>${Math.round(ac.controls.mixture * 100)}%</span></div>
      <div class="line ext"><i>FLAPS</i><span>${Math.round(s.flaps)}°</span><i>TRIM</i><span>${(ac.controls.trim * 100).toFixed(0)}</span><i>FUEL</i><span>${((s.fuelL + s.fuelR) / 3.785).toFixed(1)} gal</span></div>
      <div class="line ext"><i>MAGS</i><span>${MAG_LABEL[ac.engine.magnetos]}</span><i>BRK</i><span>${ac.controls.parkingBrake ? 'PARK' : ac.controls.brakeL > 0 ? 'ON' : 'OFF'}</span><i>${ac.engine.running ? 'ENG RUN' : 'ENG OFF'}</i></div>
      <div class="line ext"><i>POS</i><span>${s.lat.toFixed(4)}, ${s.lon.toFixed(4)}</span></div>
      <div class="line ext"><i>WIND</i><span>${Math.round(windFrom)}° / ${Math.round(wind / KT)} kt</span><i>VIS</i><span>${extra.visibilityKm} km</span></div>
      ${nav ? `<div class="line"><i>${extra.nav.mode === 'DTO' ? 'D→' : 'NRST'} ${nav.ident}</i><span>${Math.round(nav.brgMag)}° ${nav.distNm.toFixed(1)} NM</span></div>` : ''}
      ${s.onGround ? `<div class="line"><i>SURFACE</i><span>${s.surface}</span></div>` : ''}
      ${worst || dmg.destroyed ? `<div class="line dmg"><i>DAMAGE</i><span>${dmg.destroyed ? 'DESTROYED' : worst}</span></div>` : ''}
      ${extra.lastLanding ? `<div class="line"><i>LAST TOUCHDOWN</i><span>${extra.lastLanding}</span></div>` : ''}`;
  }
}
