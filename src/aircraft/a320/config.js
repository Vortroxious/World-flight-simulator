// NB-320 Meridian — A320-class narrowbody twinjet, fly-by-wire with sidestick (normal law).
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'a320', name: 'NB-320 Meridian', class: 'A320-class narrowbody twinjet, fly-by-wire sidestick (normal law with protections)', category: 'transport', family: 'narrowbody',
  mass: { empty: 42600, maxTakeoff: 78000, crewDefault: 400, payloadDefault: 13500 },
  geometry: { wingArea: 122.6, span: 35.8, chord: 4.29, length: 37.57, fuselageDia: 3.95, dihedralDeg: 5.1, sweepDeg: 25, stabSpan: 12.45, eyePoint: [14.1, -0.55, -0.9] },
  layout: { noseX: 12.6, mainX: -0.9, mainY: 3.8, cgHeight: 3.7, noseTipX: 17.0, bellyZ: 1.98, roofZ: -1.98, tailStrikeX: -12, tailStrikeZ: 1.35, finX: -19, finTopZ: -8.0, stabX: -17.5, stabZ: -0.5, wingTipX: -4.5, wingZ: 1.5 },
  engine: { type: 'turbofan', maxThrust: 120000, idleN1: 21, idleN2: 60, tsfc: 1.0e-5, densityLapse: 0.8, machLapse: 0.5, reverser: { efficiency: 0.45 }, inletArea: 2.6 },
  engines: [{ position: [3.0, -5.75, 2.1], thrustAxis: [1, 0, 0], nacelleRadius: 1.05 }, { position: [3.0, 5.75, 2.1], thrustAxis: [1, 0, 0], nacelleRadius: 1.05 }],
  aero: {
    generic: { CL0: 0.22, CLalpha: 5.1, CLmax: 1.55, alphaStallDeg: 14, kind: 'swept' }, CD0: 0.0215, oswald: 0.8, mach: { mcrit: 0.77, rise: 2.0 },
    flaps: [
      { deg: 0, label: '0', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 },
      { deg: 5, label: '1', dCL: 0.22, alphaShift: -3, dCD: 0.005, dCm: -0.01 },
      { deg: 10, label: '1+F', dCL: 0.45, alphaShift: -3, dCD: 0.012, dCm: -0.03 },
      { deg: 15, label: '2', dCL: 0.68, alphaShift: -2.5, dCD: 0.022, dCm: -0.05 },
      { deg: 20, label: '3', dCL: 0.88, alphaShift: -2.5, dCD: 0.034, dCm: -0.06 },
      { deg: 35, label: 'FULL', dCL: 1.08, alphaShift: -2, dCD: 0.06, dCm: -0.08 },
    ],
    flapRateDegPerSec: 1.6, flapDrive: 'hydraulic', spoilers: { dCD: 0.05, dCL: 0.35, groundDCL: 0.9, groundDCD: 0.09 },
  },
  controls: { elevatorUpDeg: 30, elevatorDownDeg: 17, aileronDeg: 25, rudderDeg: 30, trimRangeRad: 0.3, nosewheelSteerDeg: 6, tillerDeg: 75, input: 'sidestick' },
  fuel: { densityKgL: 0.8, type: 'Jet-A', tanks: [{ name: 'LEFT', capacityL: 7980, unusableL: 30, defaultFrac: 0.6 }, { name: 'RIGHT', capacityL: 7980, unusableL: 30, defaultFrac: 0.6 }, { name: 'CENTER', capacityL: 8250, unusableL: 30, defaultFrac: 0.1 }] },
  limits: { takeoffFlap: 2, Vs0: 108, Vs1: 145, Vr: 145, V2: 150, Vy: 250, Vref: 135, Va: 250, Vmo: 350, Mmo: 0.82, Vne: 350, Vle: 280, Vlo: 250, Vfe: [[5, 230], [10, 215], [15, 200], [20, 185], [35, 177]], cruiseKtas: 450, serviceCeilingFt: 39800 },
  fbw: { law: 'airbus', maxBank: 67, bankHold: 33, pMax: 15, qMax: 5, nzMax: 2.5, nzMin: -1, alphaProtDeg: 11.5, alphaMaxDeg: 13.5, pitchMax: 30, pitchMin: -15 },
  autopilot: { maxBank: 25, maxVs: 6000, at: true, flc: true, app: true, nav: true, autoland: true, pitchRate: 3, rollRate: 5, spdLabel: 'SPD', flcLabel: 'OP CLB' },
  systems: { pressurization: { maxDiffPsi: 8.6 }, hydraulics: [{ name: 'G', pumps: [{ engine: 0 }] }, { name: 'Y', pumps: [{ engine: 1 }, { electric: true }] }, { name: 'B', pumps: [{ electric: true }] }] },
  sound: { profile: 'turbofan', fanBlades: 36 },
  model: { type: 'airliner', variant: 'narrowbody', winglet: 'sharklet', livery: [0.95, 0.96, 0.97], tail: [0.1, 0.25, 0.55] }, cockpit: { type: 'glass-airliner', input: 'sidestick' },
});
