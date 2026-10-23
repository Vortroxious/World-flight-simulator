// Aircraft command layer shared by keyboard, gamepad and clickable cockpit controls.
// Every command changes simulation state; displays only read state.
import { clamp } from '../core/math.js';
import { MAGS } from './fdm/propulsion/piston.js';

export const SELECTOR = ['LEFT', 'BOTH', 'RIGHT', 'OFF'];
export const MAG_LABEL = ['OFF', 'R', 'L', 'BOTH', 'START'];
export const SWITCHES = [
  ['battery', 'BAT'], ['alternator', 'ALT'], ['avionics', 'AVIONICS'], ['beacon', 'BCN'], ['landingLight', 'LAND'],
  ['taxiLight', 'TAXI'], ['navLights', 'NAV'], ['strobe', 'STROBE'], ['pitotHeat', 'PITOT HT'], ['fuelPump', 'FUEL PUMP'],
];

export function createCommands(ac, hooks = {}) {
  const k = ac.controls, fire = (name, v) => hooks.onCommand?.(name, v);
  const cmd = {
    setThrottle(v) { k.throttle = clamp(v, 0, 1); },
    throttle(d) { cmd.setThrottle(k.throttle + d); },
    setMixture(v) { k.mixture = clamp(v, 0, 1); },
    mixture(d) { cmd.setMixture(k.mixture + d); },
    flaps(dir) {
      const n = ac.cfg.aero.flaps.length - 1;
      const v = clamp(k.flapsLever + dir, 0, n);
      if (v !== k.flapsLever) { k.flapsLever = v; fire('flaps', v); }
    },
    setFlaps(i) { const n = ac.cfg.aero.flaps.length - 1; k.flapsLever = clamp(Math.round(i), 0, n); fire('flaps', k.flapsLever); },
    trim(d) { k.trim = clamp(k.trim + d, -1, 1); },
    toggleParkingBrake() { k.parkingBrake = !k.parkingBrake; fire('parkingBrake', k.parkingBrake); },
    setBrakes(l, r = l) { k.brakeL = clamp(l, 0, 1); k.brakeR = clamp(r, 0, 1); },
    toggleSwitch(name) { ac.elec.switches[name] = !ac.elec.switches[name]; fire('switch', name); },
    setSwitch(name, v) { ac.elec.switches[name] = !!v; fire('switch', name); },
    setMagnetos(m) { ac.engine.magnetos = clamp(m, MAGS.OFF, MAGS.START); fire('magnetos', ac.engine.magnetos); },
    magnetos(d) {
      // Key spring-returns from START to BOTH (see releaseStarter)
      cmd.setMagnetos(ac.engine.magnetos + d);
    },
    releaseStarter() { if (ac.engine.magnetos === MAGS.START) cmd.setMagnetos(MAGS.BOTH); },
    fuelSelector(dir = 1) { const i = SELECTOR.indexOf(ac.fuel.selector); ac.fuel.selector = SELECTOR[(i + dir + SELECTOR.length) % SELECTOR.length]; fire('fuelSelector', ac.fuel.selector); },
    kollsman(dInHg) { ac.inst.kollsman = clamp(ac.inst.kollsman + dInHg * 3386.389, 28.0 * 3386.389, 31.0 * 3386.389); },
    setKollsman(pa) { ac.inst.kollsman = pa; },
    dgSync() { ac.inst.syncDG(); },
    dgBug(d) { ac.inst.dgBug = ((ac.inst.dgBug + d) % 360 + 360) % 360; },
    comTune(d) { const v = Math.round((ac.avionics.com1Stby + d) * 1000) / 1000; ac.avionics.com1Stby = v > 136.975 ? 118 : v < 118 ? 136.975 : v; },
    comSwap() { const a = ac.avionics; [a.com1, a.com1Stby] = [a.com1Stby, a.com1]; },
    xpdrDigit(i, d) { const c = ac.avionics.xpdrCode.split('').map(Number); c[i] = (c[i] + d + 8) % 8; ac.avionics.xpdrCode = c.join(''); },
    xpdrMode() { ac.avionics.xpdrMode = ac.avionics.xpdrMode === 'STBY' ? 'ALT' : 'STBY'; },

    // ---- Transport / jet controls ----
    gear(down) {
      if (!ac.cfg.gear.retractable) return;
      const v = down ?? !k.gearDown;
      if (!v && ac.onGround) { fire('gearInhibit'); return; } // squat switch: no retraction on the ground
      if (v !== k.gearDown) { k.gearDown = v; fire('gear', v); }
    },
    speedbrake(d) { k.speedbrake = clamp(k.speedbrake + d, 0, 1); if (d < 0 && k.speedbrake === 0) fire('speedbrake', 0); },
    setSpeedbrake(v) { k.speedbrake = clamp(v, 0, 1); },
    armSpoilers(v) { k.spoilersArmed = v ?? !k.spoilersArmed; fire('spoilersArm', k.spoilersArmed); },
    /** Reverse thrust: only selectable at idle on the ground (lever interlock). */
    reverse(on) {
      const v = on ?? !(k.reverse > 0);
      if (v && (k.throttle > 0.08 || !ac.onGround)) return;
      k.reverse = v ? 1 : 0; fire('reverse', v);
    },
    setProp(v) { k.prop = clamp(v, 0, 1); },
    prop(d) { cmd.setProp(k.prop + d); },
    engineStart(i, on) { const e = ac.engines[i]; if (!e || e.kind === 'piston') return; e.starter = on ?? !e.starter; fire('starter', i); },
    engineFuel(i, on) { const e = ac.engines[i]; if (!e || e.kind === 'piston') return; e.fuelOn = on ?? !e.fuelOn; fire('engineFuel', i); },
    apu(on) { ac.apu.switch = on ?? !ac.apu.switch; fire('apu', ac.apu.switch); },
    hydPumps(on) { const v = on ?? !ac.hyd.systems.every((h) => h.elecPump !== false && h.engPump !== false); ac.hyd.setAll(v); fire('hyd', v); },
    packs(on) { ac.press.packs = on ?? !ac.press.packs; fire('packs', ac.press.packs); },
    masterReset() { ac.masterWarning = false; ac.masterCaution = false; fire('masterReset'); },

    // ---- Autopilot / autothrottle / flight director ----
    apToggle() { const ap = ac.autopilot; if (ap.engaged) ap.disengage('manual'); else if (!ap.engage(ac)) fire('apInhibit'); fire('ap', ap.engaged); },
    atToggle() { ac.autopilot.toggleAt(ac); fire('at', ac.autopilot.atEngaged); },
    fdToggle() { ac.autopilot.fd = !ac.autopilot.fd; },
    apLateral(mode) { ac.autopilot.setLateral(mode, ac); fire('apMode', mode); },
    apVertical(mode) { ac.autopilot.setVertical(mode, ac); fire('apMode', mode); },
    apBump(field, d) { ac.autopilot.bump(field, d); },
    apSync(field) {
      const s = ac.snapshot(), sel = ac.autopilot.sel;
      if (field === 'hdg') sel.hdg = Math.round(s.headingMag);
      if (field === 'alt') sel.alt = Math.round(s.alt / 0.3048 / 100) * 100;
      if (field === 'spd') sel.spd = Math.round(s.ias / 0.514444);
      if (field === 'vs') sel.vs = Math.round(s.vs / 0.3048 * 60 / 100) * 100;
    },
  };
  return cmd;
}
