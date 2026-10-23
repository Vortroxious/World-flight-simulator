// FX-16 Kestrel — F-16-class single-engine multirole fighter: afterburning turbofan, relaxed stability,
// fly-by-wire with g and angle-of-attack limiting, HUD.
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'fighter', name: 'FX-16 Kestrel', class: 'F-16-class single-engine fighter, afterburner, fly-by-wire with g/AoA limiter, HUD', category: 'fighter', family: 'fighter',
  mass: { empty: 8570, maxTakeoff: 19187, crewDefault: 100, payloadDefault: 600 },
  inertiaShape: { rx: 0.22, ry: 0.36, rz: 0.42 },
  geometry: { wingArea: 27.87, span: 9.96, chord: 3.45, length: 15.06, fuselageDia: 1.4, dihedralDeg: -1, sweepDeg: 40, stabSpan: 5.6, eyePoint: [4.6, 0, -0.95] },
  layout: { noseX: 2.6, mainX: -1.4, mainY: 1.18, cgHeight: 1.75, staticDeflection: 0.1, noseTipX: 7.8, bellyZ: 0.65, roofZ: -1.0, tailStrikeX: -7.2, tailStrikeZ: 0.6, finX: -6.8, finTopZ: -3.13, stabX: -6.0, stabZ: 0.25, wingTipX: -2.5, wingZ: 0.3, noseWheelRadius: 0.24, mainWheelRadius: 0.35 },
  engine: { type: 'turbofan', maxThrust: 76300, idleN1: 30, idleN2: 70, tsfc: 2.0e-5, densityLapse: 0.75, machLapse: 0.3, machRam: 0.28, afterburner: { thrustMult: 1.72, tsfcMult: 2.6 }, inletArea: 0.7, electricStart: true },
  engines: [{ position: [-3.0, 0, 0], thrustAxis: [1, 0, 0] }],
  aero: {
    generic: { CL0: 0.05, CLalpha: 3.6, CLmax: 1.65, alphaStallDeg: 32, kind: 'fighter' }, CD0: 0.021, oswald: 0.75, mach: { mcrit: 0.88, rise: 1.5, supersonic: true, peak: 0.022 },
    CLq: 3, CLde: 0.5, Cm0: 0, CmAlphaWingBody: 0.25, CmAlphaTail: -0.45, CmQ: -6, CmAlphaDot: -2, CmDe: 0.9,
    CYbeta: -1.0, CYdr: -0.2, ClBeta: -0.06, ClP: -0.3, ClR: 0.05, ClDa: 0.12, ClDr: 0, CnBeta: 0.18, CnP: -0.02, CnR: -0.3, CnDa: -0.01, CnDr: 0.08, CDbeta2: 0.4,
    flaps: [{ deg: 0, label: 'AUTO', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 }, { deg: 20, label: 'GEAR DN', dCL: 0.25, alphaShift: 0, dCD: 0.02, dCm: -0.02 }],
    flapRateDegPerSec: 10, flapDrive: 'hydraulic', autoFlaps: true, spoilers: { dCD: 0.06, dCL: 0, groundDCL: 0, groundDCD: 0.06 },
  },
  controls: { elevatorUpDeg: 25, elevatorDownDeg: 25, aileronDeg: 20, rudderDeg: 30, trimRangeRad: 0.08, nosewheelSteerDeg: 32, keyboardRate: 2.4, input: 'sidestick' },
  fuel: { densityKgL: 0.8, type: 'JP-8', tanks: [{ name: 'FWD', capacityL: 1980, unusableL: 20, defaultFrac: 0.75 }, { name: 'AFT', capacityL: 1980, unusableL: 20, defaultFrac: 0.75 }] },
  electrical: { batteryAh: 20, alternatorAmps: 150 },
  gear: { transitSec: 5, dragCD: 0.02, brakeMu: 0.6 },
  limits: { takeoffFlap: 0, Vs0: 120, Vs1: 130, Vr: 150, V2: 165, Vy: 350, Vref: 145, Va: 420, Vmo: 800, Mmo: 2.05, Vne: 800, Vle: 300, Vlo: 300, Vfe: [[20, 370]], cruiseKtas: 500, serviceCeilingFt: 50000 },
  damage: { gLimitPos: 9.0, gLimitNeg: -3.0 },
  fbw: { law: 'fighter', nzMax: 9, nzMin: -3, pMax: 240, qMax: 25, alphaProtDeg: 21, alphaMaxDeg: 25, maxBank: 360, pitchMax: 90, pitchMin: -90 },
  autopilot: { maxBank: 45, maxVs: 10000, at: false, flc: false, app: false, nav: true, pitchRate: 6, rollRate: 30 },
  systems: { gpws: false, pressurization: { maxDiffPsi: 5 }, hydraulics: [{ name: 'A', pumps: [{ engine: 0 }] }, { name: 'B', pumps: [{ engine: 0 }] }], yawDamper: true },
  sound: { profile: 'fighter' },
  model: { type: 'fighter' }, cockpit: { type: 'fighter-hud', input: 'sidestick' },
});
