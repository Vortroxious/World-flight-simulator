// WB-789 Horizon — 787-9-class widebody twinjet, fly-by-wire with yoke, raked wingtips.
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'b787', name: 'WB-789 Horizon', class: '787-9-class widebody twinjet, fly-by-wire yoke with envelope protection', category: 'transport', family: 'widebody',
  mass: { empty: 128850, maxTakeoff: 254000, crewDefault: 800, payloadDefault: 25000 },
  geometry: { wingArea: 377, span: 60.1, chord: 7.5, length: 62.8, fuselageDia: 5.77, dihedralDeg: 6, sweepDeg: 32, stabSpan: 21, eyePoint: [28.4, -0.6, -1.3] },
  layout: { noseX: 25.0, mainX: -0.9, mainY: 4.9, cgHeight: 5.15, staticDeflection: 0.16, noseTipX: 30.0, bellyZ: 2.88, roofZ: -2.88, tailStrikeX: -20, tailStrikeZ: 1.9, finX: -31, finTopZ: -11.85, stabX: -29, stabZ: -0.5, wingTipX: -10, wingZ: 2.0, mainWheelRadius: 0.68 },
  engine: { type: 'turbofan', maxThrust: 320000, idleN1: 20, idleN2: 60, tsfc: 0.88e-5, densityLapse: 0.8, machLapse: 0.5, reverser: { efficiency: 0.35 }, inletArea: 6.2 },
  engines: [{ position: [6.0, -10.0, 2.6], thrustAxis: [1, 0, 0], nacelleRadius: 1.75 }, { position: [6.0, 10.0, 2.6], thrustAxis: [1, 0, 0], nacelleRadius: 1.75 }],
  aero: {
    generic: { CL0: 0.22, CLalpha: 5.4, CLmax: 1.5, alphaStallDeg: 14, kind: 'swept' }, CD0: 0.018, oswald: 0.85, mach: { mcrit: 0.83, rise: 2.0 },
    CmQ: -28, CnR: -0.22,
    flaps: [
      { deg: 0, label: 'UP', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 },
      { deg: 1, label: '1', dCL: 0.2, alphaShift: -3, dCD: 0.004, dCm: -0.01 },
      { deg: 5, label: '5', dCL: 0.42, alphaShift: -3, dCD: 0.01, dCm: -0.025 },
      { deg: 15, label: '15', dCL: 0.65, alphaShift: -2.5, dCD: 0.02, dCm: -0.04 },
      { deg: 20, label: '20', dCL: 0.8, alphaShift: -2.5, dCD: 0.028, dCm: -0.05 },
      { deg: 25, label: '25', dCL: 0.95, alphaShift: -2, dCD: 0.04, dCm: -0.06 },
      { deg: 30, label: '30', dCL: 1.05, alphaShift: -2, dCD: 0.055, dCm: -0.07 },
    ],
    flapRateDegPerSec: 1.3, flapDrive: 'hydraulic', spoilers: { dCD: 0.045, dCL: 0.3, groundDCL: 0.85, groundDCD: 0.08 },
  },
  controls: { elevatorUpDeg: 28, elevatorDownDeg: 18, aileronDeg: 22, rudderDeg: 28, trimRangeRad: 0.3, nosewheelSteerDeg: 7, tillerDeg: 70 },
  fuel: { densityKgL: 0.8, type: 'Jet-A', tanks: [{ name: 'LEFT', capacityL: 33000, unusableL: 100, defaultFrac: 0.7 }, { name: 'RIGHT', capacityL: 33000, unusableL: 100, defaultFrac: 0.7 }, { name: 'CENTER', capacityL: 60372, unusableL: 100, defaultFrac: 0.15 }] },
  limits: { takeoffFlap: 2, Vs0: 115, Vs1: 155, Vr: 155, V2: 162, Vy: 250, Vref: 150, Va: 250, Vmo: 360, Mmo: 0.9, Vne: 360, Vle: 270, Vlo: 270, Vfe: [[1, 255], [5, 235], [15, 215], [20, 200], [25, 180], [30, 175]], cruiseKtas: 488, serviceCeilingFt: 43100 },
  fbw: { law: 'boeing', maxBank: 35, bankHold: 35, pMax: 12, qMax: 4, nzMax: 2.5, nzMin: -1, alphaProtDeg: 11.5, alphaMaxDeg: 13.5, pitchMax: 25, pitchMin: -15, directRoll: true },
  autopilot: { maxBank: 25, maxVs: 6000, at: true, flc: true, app: true, nav: true, autoland: true, pitchRate: 2.5, rollRate: 4, spdLabel: 'SPD', flcLabel: 'FLCH' },
  systems: { pressurization: { maxDiffPsi: 9.4 }, hydraulics: [{ name: 'L', pumps: [{ engine: 0 }, { electric: true }] }, { name: 'C', pumps: [{ electric: true }] }, { name: 'R', pumps: [{ engine: 1 }, { electric: true }] }] },
  sound: { profile: 'turbofan', fanBlades: 18 },
  model: { type: 'airliner', variant: 'widebody', winglet: 'raked', livery: [0.96, 0.97, 0.98], tail: [0.08, 0.18, 0.42] }, cockpit: { type: 'glass-airliner', input: 'yoke' },
});
