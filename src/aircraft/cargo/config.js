// CT-130 Packhorse — C-130-class four-engine turboprop tactical transport (high wing, rear ramp).
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'cargo', name: 'CT-130 Packhorse', class: 'C-130-class four-engine turboprop cargo transport, high wing, rear ramp', category: 'cargo', family: 'cargo',
  mass: { empty: 34400, maxTakeoff: 70300, crewDefault: 400, payloadDefault: 12000 },
  geometry: { wingArea: 162.1, span: 40.41, chord: 4.16, length: 29.79, fuselageDia: 4.3, dihedralDeg: 2.5, stabSpan: 15.7, eyePoint: [11.1, -0.65, -1.2] },
  layout: { noseX: 9.7, mainX: -0.5, mainY: 2.2, cgHeight: 3.05, staticDeflection: 0.12, noseTipX: 13.5, bellyZ: 2.15, roofZ: -2.15, tailStrikeX: -8, tailStrikeZ: 1.6, finX: -15.8, finTopZ: -8.6, stabX: -14.5, stabZ: -1.0, wingTipX: -0.5, wingZ: -2.4 },
  engine: { type: 'turboprop', maxPower: 3424000, thermoPower: 3800000, propDiameter: 4.11, propRPM: 1020, idleNg: 70, bsfc: 0.85e-7, autoFeather: true, propEfficiency: 0.8, torqueReaction: 0.03 },
  engines: [
    { position: [3.0, -10.0, -1.9], thrustAxis: [1, 0, 0], propX: 1.5 }, { position: [3.2, -5.0, -1.9], thrustAxis: [1, 0, 0], propX: 1.5 },
    { position: [3.2, 5.0, -1.9], thrustAxis: [1, 0, 0], propX: 1.5 }, { position: [3.0, 10.0, -1.9], thrustAxis: [1, 0, 0], propX: 1.5 },
  ],
  aero: {
    generic: { CL0: 0.3, CLalpha: 5.0, CLmax: 1.5, alphaStallDeg: 15, kind: 'conventional' }, CD0: 0.031, oswald: 0.78, mach: { mcrit: 0.62, rise: 3 },
    ClBeta: -0.08, CnBeta: 0.14, CmQ: -20,
    flaps: [
      { deg: 0, label: 'UP', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 },
      { deg: 25, label: '50%', dCL: 0.5, alphaShift: 0.5, dCD: 0.02, dCm: -0.03 },
      { deg: 50, label: '100%', dCL: 0.8, alphaShift: 1, dCD: 0.06, dCm: -0.06 },
    ],
    flapRateDegPerSec: 3, flapDrive: 'hydraulic',
  },
  controls: { elevatorUpDeg: 30, elevatorDownDeg: 20, aileronDeg: 22, rudderDeg: 30, trimRangeRad: 0.25, nosewheelSteerDeg: 8, tillerDeg: 60 },
  fuel: { densityKgL: 0.8, type: 'JP-8', tanks: [{ name: 'LEFT', capacityL: 13000, unusableL: 50, defaultFrac: 0.6 }, { name: 'RIGHT', capacityL: 13000, unusableL: 50, defaultFrac: 0.6 }] },
  gear: { transitSec: 15, dragCD: 0.02 },
  limits: { takeoffFlap: 1, Vs0: 95, Vs1: 115, Vr: 120, V2: 130, Vy: 170, Vref: 125, Va: 200, Vmo: 250, Mmo: 0.6, Vne: 250, Vle: 168, Vlo: 168, Vfe: [[25, 195], [50, 145]], cruiseKtas: 292, serviceCeilingFt: 33000 },
  damage: { gLimitPos: 2.5, gLimitNeg: -1.0 },
  autopilot: { maxBank: 25, maxVs: 3000, at: false, flc: true, app: true, nav: true, pitchRate: 2.5, rollRate: 4 },
  systems: { pressurization: { maxDiffPsi: 7.5 }, hydraulics: [{ name: 'UTIL', pumps: [{ engine: 0 }, { engine: 1 }] }, { name: 'BOOST', pumps: [{ engine: 2 }, { engine: 3 }, { electric: true }] }] },
  sound: { profile: 'turboprop', blades: 4 },
  model: { type: 'cargo-4prop' }, cockpit: { type: 'glass-turboprop' },
});
