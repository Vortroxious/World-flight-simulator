// TP-200 Stratus — King Air 200-class twin turboprop (T-tail, retractable gear, pressurised).
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'kingair', name: 'TP-200 Stratus', class: 'King Air 200-class twin turboprop, T-tail, pressurised, retractable gear', category: 'turboprop', family: 'twin-turboprop',
  mass: { empty: 3700, maxTakeoff: 5670, crewDefault: 170, payloadDefault: 400 },
  geometry: { wingArea: 28.15, span: 16.61, chord: 1.98, length: 13.34, fuselageDia: 1.6, dihedralDeg: 6, stabSpan: 5.6, eyePoint: [4.2, -0.38, -0.25] },
  layout: { noseX: 4.3, mainX: -0.6, mainY: 2.6, cgHeight: 2.0, staticDeflection: 0.1, noseTipX: 6.0, bellyZ: 0.8, roofZ: -0.85, tailStrikeX: -5.6, tailStrikeZ: 0.45,
    finX: -7.0, finTopZ: -2.6, stabX: -6.8, stabZ: -2.5, wingTipX: -0.4, wingZ: 0.55, noseWheelRadius: 0.25, mainWheelRadius: 0.33 },
  engine: { type: 'turboprop', maxPower: 634000, thermoPower: 760000, propDiameter: 2.5, propRPM: 2000, idleNg: 58, bsfc: 0.93e-7, autoFeather: true, propEfficiency: 0.82, torqueReaction: 0.05 },
  engines: [{ position: [1.5, -2.6, 0.25], thrustAxis: [1, 0, 0], propX: 1.4 }, { position: [1.5, 2.6, 0.25], thrustAxis: [1, 0, 0], propX: 1.4 }],
  aero: {
    generic: { CL0: 0.3, CLalpha: 5.0, CLmax: 1.6, alphaStallDeg: 16, kind: 'conventional' }, CD0: 0.026, oswald: 0.8, mach: { mcrit: 0.6, rise: 3 },
    CLq: 4.5, CLde: 0.4, Cm0: 0.05, CmAlphaWingBody: 0.3, CmAlphaTail: -2.0, CmQ: -15, CmAlphaDot: -5, CmDe: 1.3,
    CYbeta: -0.6, CYdr: -0.2, ClBeta: -0.1, ClP: -0.45, ClR: 0.1, ClDa: 0.15, ClDr: -0.012, CnBeta: 0.1, CnP: -0.04, CnR: -0.15, CnDa: -0.01, CnDr: 0.09, CDbeta2: 0.2,
    flaps: [
      { deg: 0, label: 'UP', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 },
      { deg: 15, label: 'APPR', dCL: 0.35, alphaShift: 0.5, dCD: 0.012, dCm: -0.02 },
      { deg: 35, label: 'DN', dCL: 0.7, alphaShift: 1, dCD: 0.045, dCm: -0.04 },
    ],
    flapRateDegPerSec: 4, flapDrive: 'electric',
  },
  controls: { elevatorUpDeg: 20, elevatorDownDeg: 15, aileronDeg: 16, rudderDeg: 25, trimRangeRad: 0.25, trimRatePerSec: 0.12, keyboardRate: 2, nosewheelSteerDeg: 14, tillerDeg: 45 },
  fuel: { densityKgL: 0.8, type: 'Jet-A', tanks: [{ name: 'LEFT', capacityL: 1030, unusableL: 10, defaultFrac: 0.6 }, { name: 'RIGHT', capacityL: 1030, unusableL: 10, defaultFrac: 0.6 }] },
  electrical: { batteryAh: 42, alternatorAmps: 250 },
  gear: { transitSec: 6, dragCD: 0.022, hydraulic: false, brakeMu: 0.6 },
  limits: { Vs0: 75, Vs1: 88, Vr: 94, V2: 106, Vx: 100, Vy: 125, Vref: 105, Va: 181, Vmo: 259, Mmo: 0.52, Vne: 259, Vle: 181, Vlo: 163, Vfe: [[15, 200], [35, 157]], cruiseKtas: 280, serviceCeilingFt: 35000 },
  damage: { gLimitPos: 3.17, gLimitNeg: -1.27 },
  autopilot: { maxBank: 25, maxVs: 2500, at: false, flc: true, app: true, nav: true, pitchRate: 3, rollRate: 6 },
  systems: { pressurization: { maxDiffPsi: 6.5 }, apu: false, hydraulics: null },
  sound: { profile: 'turboprop', blades: 4 },
  model: { type: 'twin-turboprop' }, cockpit: { type: 'glass-turboprop' },
});
