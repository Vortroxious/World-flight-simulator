// Debug / telemetry panel: simulation internals, timing, streaming stats, collision events and damage state.
import { h } from './dom.js';
import { KT, FT } from '../core/units.js';
import { SIM_DT } from '../sim/aircraft.js';

export class DebugPanel {
  constructor(root) { this.el = h('div', { class: 'debug', id: 'debug', style: { display: 'none' } }); root.append(this.el); this.visible = false; this.t = 0; }
  toggle() { this.visible = !this.visible; this.el.style.display = this.visible ? '' : 'none'; }
  remove() { this.el.remove(); }
  update(dt, ac, st) {
    this.t += dt;
    if (!this.visible || this.t < 0.15) return;
    this.t = 0;
    const s = ac.snapshot(), d = ac.damage;
    const kv = (rows) => `<div class="kv">${rows.map(([k, v]) => `<div>${k}</div><div>${v}</div>`).join('')}</div>`;
    const tr = st.terrain;
    this.el.innerHTML = `
      <h4>Position</h4>${kv([['lat / lon', `${s.lat.toFixed(6)} / ${s.lon.toFixed(6)}`], ['alt MSL', `${s.alt.toFixed(1)} m (${Math.round(s.alt / FT)} ft)`], ['AGL / ground', `${s.agl.toFixed(1)} m / ${s.groundElev.toFixed(1)} m`], ['surface', `${s.surface}${s.inWater ? ' (in water)' : ''}`]])}
      <h4>Air data</h4>${kv([['IAS / TAS / GS', `${(s.ias / KT).toFixed(1)} / ${(s.tas / KT).toFixed(1)} / ${(s.gs / KT).toFixed(1)} kt`], ['VS', `${s.vs.toFixed(2)} m/s (${Math.round(s.vs / FT * 60)} fpm)`], ['AoA / sideslip', `${s.alpha.toFixed(2)}° / ${s.beta.toFixed(2)}°`], ['CL / CD / stall', `${s.CL.toFixed(3)} / ${s.CD.toFixed(4)} / ${s.stall.toFixed(2)}`], ['load factor', `${s.nz.toFixed(2)} g (max ${d.maxG.toFixed(2)}, min ${d.minG.toFixed(2)})`], ['wind NED', ac.windNed.map((v) => v.toFixed(1)).join(', ') + ' m/s']])}
      <h4>Attitude</h4>${kv([['pitch / roll', `${s.pitch.toFixed(2)}° / ${s.roll.toFixed(2)}°`], ['heading T / M', `${s.heading.toFixed(1)}° / ${s.headingMag.toFixed(1)}° (var ${ac.magvar.toFixed(1)}°)`], ['p / q / r', `${s.p.toFixed(1)} / ${s.q.toFixed(1)} / ${s.r.toFixed(1)} °/s`]])}
      <h4>Engines & systems</h4>${kv([...ac.engines.map((x, i) => [`eng ${i + 1} (${x.kind})`, x.kind === 'piston' ? `${x.rpm.toFixed(0)} rpm, ${(x.power / 1000).toFixed(1)} kW, MAP ${(x.map / 3386.389).toFixed(1)} inHg, φ ${x.phi.toFixed(2)}` : x.kind === 'turbofan' ? `N1 ${x.n1.toFixed(1)} N2 ${x.n2.toFixed(1)} EGT ${x.egt.toFixed(0)}${x.afterburner ? ' AB' : ''}${x.reverser > 0.05 ? ' REV' : ''}` : `Ng ${x.ng.toFixed(1)} Np ${x.np.toFixed(0)} ITT ${x.itt.toFixed(0)}${x.feathered ? ' FTHR' : ''}`]),
        ['thrust total', `${(s.thrust / 1000).toFixed(2)} kN`], ['fuel flow', `${(s.fuelFlow * 3600).toFixed(1)} kg/h`], ['mach / gear / spoilers', `${s.mach.toFixed(3)} / ${s.gearPos.toFixed(2)} / ${s.spoilers.toFixed(2)}`],
        ['AP', `${ac.autopilot.engaged ? 'ON' : 'off'} ${ac.autopilot.lat}/${ac.autopilot.vert} pitchT ${ac.autopilot.pitchT.toFixed(1)} bankT ${ac.autopilot.bankT.toFixed(1)}`], ['FBW', ac.fbw ? `${ac.fbw.law} ${ac.fbw.protections.join(',')}` : '—'],
        ['hyd / cabin', `${ac.hyd.systems.map((h) => Math.round(h.pressure)).join('/') || '—'} psi · ${Math.round(ac.press.cabinAltFt)} ft`], ['bus / batt', `${ac.elec.busVolts.toFixed(1)} V / ${ac.elec.batteryAmps.toFixed(1)} A, SOC ${(ac.elec.soc * 100).toFixed(0)}%`], ['mass', `${s.mass.toFixed(1)} kg`], ['gear loads', ac.wheelState.map((w) => (w.force / 1000).toFixed(1)).join(' / ') + ' kN']])}
      <h4>Timing</h4>${kv([['fps / frame', `${st.fps.toFixed(0)} / ${st.frameMs.toFixed(1)} ms`], ['sim step', `${(SIM_DT * 1000).toFixed(2)} ms (${Math.round(1 / SIM_DT)} Hz), ${st.steps} steps/frame`], ['pixel ratio', st.pixelRatio.toFixed(2)], ['draw calls / tris', `${st.calls} / ${(st.tris / 1000).toFixed(0)}k`]])}
      <h4>World streaming</h4>${kv([['tiles loaded / visible', `${tr.loaded - 0} / ${tr.visible}`], ['in flight / requested', `${tr.inFlight} / ${tr.requested}`], ['online / fallback', `${tr.online} / ${tr.fallback}`], ['scenery tiles', st.sceneryTiles], ['airports built', st.airports], ['obstacle groups', st.obstacles], ['origin shifts', st.originShifts]])}
      <h4>Damage (${d.mode})</h4>${kv(Object.entries(d.health).map(([k, v]) => [k, `${Math.round(v * 100)}%${d.detached[k] ? ' DETACHED' : ''}`]))}
      <h4>Collision / damage events</h4>${[...ac.events.slice(-5).map((x) => `<div class="ev">${x.t.toFixed(1)}s ${x.type} ${x.point} ${x.surface || ''} ${x.vn != null ? x.vn.toFixed(1) + ' m/s' : ''}</div>`), ...d.events.slice(-6).map((x) => `<div class="ev">${x.t}s ${x.type} ${x.component} ${x.detail}</div>`)].join('') || '<div class="note">none</div>'}`;
  }
}
