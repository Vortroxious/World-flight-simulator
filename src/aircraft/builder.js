// Builds full aircraft configurations from compact, dimension-based definitions: landing-gear struts
// (stiffness from static load), airframe contact points (nose, belly, tail-strike, wing tips, stabiliser,
// fin, nacelles/propeller tips), inertia estimates, damage thresholds and engine component names.
// Body axes: x forward of the CG, y right, z down (metres).

const G = 9.80665;

const TRANSPORT_DERIVS = {
  CLq: 5, CLde: 0.35, Cm0: 0.06, CmAlphaWingBody: 0.4, CmAlphaTail: -1.9, CmQ: -22, CmAlphaDot: -7, CmDe: 1.4,
  CYbeta: -0.8, CYdr: -0.16, ClBeta: -0.12, ClP: -0.42, ClR: 0.12, ClDa: 0.1, ClDr: -0.01,
  CnBeta: 0.16, CnP: -0.04, CnR: -0.24, CnDa: -0.006, CnDr: 0.11, pFactor: 0, slipstreamYaw: 0, CDbeta2: 0.25,
};

export function estimateInertia(m, span, length, k = {}) {
  const rx = k.rx ?? 0.25, ry = k.ry ?? 0.38, rz = k.rz ?? 0.47;
  return { Ixx: Math.round(m * (rx * span / 2) ** 2), Iyy: Math.round(m * (ry * length / 2) ** 2), Izz: Math.round(m * (rz * (span + length) / 4) ** 2), Ixz: 0 };
}

/**
 * @param {object} p compact definition (see src/aircraft/*.js)
 */
export function defineAircraft(p) {
  const g = p.geometry, m = p.mass, L = p.layout;
  const W = m.maxTakeoff * G * 0.85; // typical operating weight for strut sizing
  const noseShare = -L.mainX / (L.noseX - L.mainX);
  const defl = L.staticDeflection ?? 0.14;
  const strut = (share) => { const k = (share * W) / defl; return { k: Math.round(k), c: Math.round(2 * 0.55 * Math.sqrt(k * share * W / G)) }; };
  const nose = strut(noseShare), main = strut((1 - noseShare) / 2);
  const H = L.cgHeight;
  const wheels = [
    { name: 'nose', component: 'noseGear', pos: [L.noseX, 0, H], ...nose, travel: defl * 2.5, steer: true, brake: false, radius: L.noseWheelRadius ?? 0.4 },
    { name: 'leftMain', component: 'leftMainGear', pos: [L.mainX, -L.mainY, H], ...main, travel: defl * 2.5, steer: false, brake: true, radius: L.mainWheelRadius ?? 0.6 },
    { name: 'rightMain', component: 'rightMainGear', pos: [L.mainX, L.mainY, H], ...main, travel: defl * 2.5, steer: false, brake: true, radius: L.mainWheelRadius ?? 0.6 },
  ];
  const tan = Math.tan(((g.dihedralDeg ?? 0) * Math.PI) / 180);
  const tipZ = L.wingZ - (g.span / 2) * tan;
  const contacts = [
    { name: 'nose', component: 'fuselage', pos: [L.noseTipX, 0, L.bellyZ * 0.6] },
    { name: 'bellyFwd', component: 'fuselage', pos: [L.noseX * 0.7, 0, L.bellyZ] },
    { name: 'bellyMid', component: 'fuselage', pos: [0, 0, L.bellyZ] },
    { name: 'bellyAft', component: 'fuselage', pos: [L.tailStrikeX * 0.6, 0, (L.bellyZ + L.tailStrikeZ) / 2] },
    { name: 'tailStrike', component: 'fuselage', pos: [L.tailStrikeX, 0, L.tailStrikeZ] },
    { name: 'roof', component: 'fuselage', pos: [0, 0, L.roofZ] },
    { name: 'finTop', component: 'vStab', pos: [L.finX, 0, L.finTopZ] },
    { name: 'leftStabTip', component: 'hStab', pos: [L.stabX, -g.stabSpan / 2, L.stabZ] },
    { name: 'rightStabTip', component: 'hStab', pos: [L.stabX, g.stabSpan / 2, L.stabZ] },
    { name: 'leftWingTip', component: 'leftWing', pos: [L.wingTipX, -g.span / 2, tipZ] },
    { name: 'rightWingTip', component: 'rightWing', pos: [L.wingTipX, g.span / 2, tipZ] },
    { name: 'leftWingMid', component: 'leftWing', pos: [L.wingTipX * 0.5, -g.span / 4, L.wingZ - (g.span / 4) * tan] },
    { name: 'rightWingMid', component: 'rightWing', pos: [L.wingTipX * 0.5, g.span / 4, L.wingZ - (g.span / 4) * tan] },
  ];
  const components = {};
  const cat = p.category;
  const gearV = cat === 'fighter' ? [3.6, 5.5] : cat === 'ga' ? [3.0, 4.8] : [3.1, 4.7];
  const scrape = (base) => Math.round(base * (m.maxTakeoff / 1000) ** 0.8);
  Object.assign(components, {
    noseGear: { vSafe: gearV[0] * 0.85, vFail: gearV[1] * 0.85, loadLimit: Math.round(noseShare * W * 3.5), sideLimit: Math.round(noseShare * W * 1.2), detachable: true },
    leftMainGear: { vSafe: gearV[0], vFail: gearV[1], loadLimit: Math.round((1 - noseShare) / 2 * W * 3.2), sideLimit: Math.round((1 - noseShare) / 2 * W * 1.1), detachable: true },
    rightMainGear: { vSafe: gearV[0], vFail: gearV[1], loadLimit: Math.round((1 - noseShare) / 2 * W * 3.2), sideLimit: Math.round((1 - noseShare) / 2 * W * 1.1), detachable: true },
    fuselage: { vSafe: 1.5, vFail: 9.0, scrapeEnergy: scrape(900000), detachable: false },
    leftWing: { vSafe: 1.0, vFail: 6.5, scrapeEnergy: scrape(250000), detachable: true },
    rightWing: { vSafe: 1.0, vFail: 6.5, scrapeEnergy: scrape(250000), detachable: true },
    hStab: { vSafe: 1.0, vFail: 6.0, scrapeEnergy: scrape(120000), detachable: true },
    vStab: { vSafe: 1.0, vFail: 6.0, scrapeEnergy: scrape(120000), detachable: true },
  });
  const engines = p.engines.map((e, i) => {
    const n = i + 1;
    const ec = { ...p.engine, ...e, component: `engine${n}`, propComponent: e.prop || p.engine.type === 'turboprop' ? `propeller${n}` : null };
    components[`engine${n}`] = { vSafe: 1.0, vFail: 5.0, scrapeEnergy: scrape(80000), detachable: false };
    if (ec.type === 'turbofan' && e.nacelleRadius) contacts.push({ name: `nacelle${n}`, component: `engine${n}`, pos: [e.position[0], e.position[1], e.position[2] + e.nacelleRadius] });
    if (ec.type === 'turboprop' || ec.type === 'piston') {
      components[`propeller${n}`] = { vSafe: 0, vFail: 2.5, detachable: false };
      contacts.push({ name: `propTip${n}`, component: `propeller${n}`, pos: [e.position[0] + (e.propX ?? 1.2), e.position[1], e.position[2] + ec.propDiameter / 2] });
    }
    return ec;
  });
  return {
    id: p.id, name: p.name, class: p.class, category: p.category, family: p.family, fidelity: p.fidelity ?? 'Coefficient-based 6-DOF model from public dimensions and performance figures; not certified data.',
    mass: { ...m, inertiaAtMtow: m.inertiaAtMtow ?? estimateInertia(m.maxTakeoff, g.span, g.length, p.inertiaShape) },
    geometry: { ...g },
    aero: { ...TRANSPORT_DERIVS, ...p.aero },
    controls: { keyboardRate: 1.6, keyboardReturnRate: 2.5, trimRatePerSec: 0.08, ...p.controls },
    engines,
    fuel: p.fuel,
    electrical: { batteryVolts: 24, batteryAh: 40, alternatorVolts: 28, alternatorAmps: 400, lowVolts: 24, ...p.electrical },
    gear: { retractable: true, transitSec: 9, dragCD: 0.018, hydraulic: true, brakeMu: 0.55, rollingMu: 0.012, lateralMu: 0.7, ...p.gear, wheels },
    contacts: [...contacts, ...(p.extraContacts || [])],
    damage: { components, gLimitPos: 2.5, gLimitNeg: -1.0, ultimateFactor: 1.5, flutterMargin: 1.1, ...p.damage },
    limits: p.limits,
    fbw: p.fbw || null,
    autopilot: p.autopilot,
    systems: { gpws: true, apu: cat !== 'fighter' && cat !== 'ga', yawDamper: cat !== 'ga', ...p.systems },
    sound: p.sound,
    model: p.model,
    cockpit: p.cockpit,
  };
}
