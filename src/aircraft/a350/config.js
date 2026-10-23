// WB-359 Aurora — A350-900-class widebody twinjet, fly-by-wire sidestick.
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'a350', name: 'WB-359 Aurora', class: 'A350-900-class widebody twinjet, fly-by-wire sidestick (normal law with protections)', category: 'transport', family: 'widebody',
  mass: { empty: 142400, maxTakeoff: 280000, crewDefault: 900, payloadDefault: 30000 },
  geometry: { wingArea: 442, span: 64.75, chord: 8.0, length: 66.8, fuselageDia: 5.96, dihedralDeg: 5.5, sweepDeg: 31.9, stabSpan: 19, eyePoint: [30.4, -0.6, -1.35] },
  layout: { noseX: 27.5, mainX: -1.0, mainY: 5.3, cgHeight: 5.3, staticDeflection: 0.16, noseTipX: 31.0, bellyZ: 2.98, roofZ: -2.98, tailStrikeX: -22, tailStrikeZ: 2.6, finX: -34, finTopZ: -11.75, stabX: -32, stabZ: -0.5, wingTipX: -11, wingZ: 2.1, mainWheelRadius: 0.7 },
  engine: { type: 'turbofan', maxThrust: 374000, idleN1: 20, idleN2: 60, tsfc: 0.86e-5, densityLapse: 0.8, machLapse: 0.5, reverser: { efficiency: 0.35 }, inletArea: 7.0 },
  engines: [{ position: [6.5, -10.6, 2.7], thrustAxis: [1, 0, 0], nacelleRadius: 1.8 }, { position: [6.5, 10.6, 2.7], thrustAxis: [1, 0, 0], nacelleRadius: 1.8 }],
  aero: {
    generic: { CL0: 0.22, CLalpha: 5.4, CLmax: 1.55, alphaStallDeg: 14, kind: 'swept' }, CD0: 0.0175, oswald: 0.86, mach: { mcrit: 0.83, rise: 2.0 },
    CmQ: -28, CnR: -0.22,
    flaps: [
      { deg: 0, label: '0', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 },
      { deg: 5, label: '1', dCL: 0.22, alphaShift: -3, dCD: 0.005, dCm: -0.01 },
      { deg: 10, label: '1+F', dCL: 0.45, alphaShift: -3, dCD: 0.012, dCm: -0.03 },
      { deg: 15, label: '2', dCL: 0.68, alphaShift: -2.5, dCD: 0.022, dCm: -0.05 },
      { deg: 20, label: '3', dCL: 0.9, alphaShift: -2.5, dCD: 0.034, dCm: -0.06 },
      { deg: 35, label: 'FULL', dCL: 1.1, alphaShift: -2, dCD: 0.058, dCm: -0.08 },
    ],
    flapRateDegPerSec: 1.3, flapDrive: 'hydraulic', spoilers: { dCD: 0.045, dCL: 0.3, groundDCL: 0.85, groundDCD: 0.08 },
  },
  controls: { elevatorUpDeg: 30, elevatorDownDeg: 17, aileronDeg: 25, rudderDeg: 30, trimRangeRad: 0.3, nosewheelSteerDeg: 6, tillerDeg: 72, input: 'sidestick' },
  fuel: { densityKgL: 0.8, type: 'Jet-A', tanks: [{ name: 'LEFT', capacityL: 40000, unusableL: 100, defaultFrac: 0.7 }, { name: 'RIGHT', capacityL: 40000, unusableL: 100, defaultFrac: 0.7 }, { name: 'CENTER', capacityL: 61000, unusableL: 100, defaultFrac: 0.15 }] },
  limits: { Vs0: 108, Vs1: 150, Vr: 150, V2: 158, Vy: 250, Vref: 140, Va: 250, Vmo: 340, Mmo: 0.89, Vne: 340, Vle: 280, Vlo: 250, Vfe: [[5, 255], [10, 220], [15, 212], [20, 195], [35, 186]], cruiseKtas: 488, serviceCeilingFt: 43100 },
  fbw: { law: 'airbus', maxBank: 67, bankHold: 33, pMax: 15, qMax: 4, nzMax: 2.5, nzMin: -1, alphaProtDeg: 11.5, alphaMaxDeg: 13.5, pitchMax: 30, pitchMin: -15 },
  autopilot: { maxBank: 25, maxVs: 6000, at: true, flc: true, app: true, nav: true, autoland: true, pitchRate: 2.5, rollRate: 4, spdLabel: 'SPD', flcLabel: 'OP CLB' },
  systems: { pressurization: { maxDiffPsi: 9.0 }, hydraulics: [{ name: 'G', pumps: [{ engine: 0 }, { electric: true }] }, { name: 'Y', pumps: [{ engine: 1 }, { electric: true }] }] },
  sound: { profile: 'turbofan', fanBlades: 22 },
  model: { type: 'airliner', variant: 'widebody', winglet: 'curved', livery: [0.95, 0.96, 0.97], tail: [0.55, 0.1, 0.25] }, cockpit: { type: 'glass-airliner', input: 'sidestick' },
});
