// NB-738 Cascade — 737-800-class narrowbody twinjet with conventional (hydro-mechanical) controls.
import { defineAircraft } from '../builder.js';

export default defineAircraft({
  id: 'b737', name: 'NB-738 Cascade', class: '737-800-class narrowbody twinjet, conventional yoke and stabiliser trim', category: 'transport', family: 'narrowbody',
  mass: { empty: 41400, maxTakeoff: 79000, crewDefault: 400, payloadDefault: 14000 },
  geometry: { wingArea: 124.6, span: 35.79, chord: 3.96, length: 39.5, fuselageDia: 3.76, dihedralDeg: 6, sweepDeg: 25, stabSpan: 14.4, eyePoint: [15.8, -0.55, -0.85] },
  layout: { noseX: 15.6, mainX: -0.8, mainY: 2.86, cgHeight: 3.76, noseTipX: 18.5, bellyZ: 1.88, roofZ: -1.88, tailStrikeX: -13.5, tailStrikeZ: 1.3, finX: -20, finTopZ: -8.7, stabX: -18.5, stabZ: -0.4, wingTipX: -3.9, wingZ: 1.6 },
  engine: { type: 'turbofan', maxThrust: 121000, idleN1: 20, idleN2: 59, tsfc: 1.0e-5, densityLapse: 0.8, machLapse: 0.5, reverser: { efficiency: 0.4 }, inletArea: 2.4 },
  engines: [{ position: [3.6, -4.9, 2.3], thrustAxis: [1, 0, 0], nacelleRadius: 1.0 }, { position: [3.6, 4.9, 2.3], thrustAxis: [1, 0, 0], nacelleRadius: 1.0 }],
  aero: {
    generic: { CL0: 0.2, CLalpha: 5.2, CLmax: 1.5, alphaStallDeg: 14.5, kind: 'swept' }, CD0: 0.0215, oswald: 0.82, mach: { mcrit: 0.77, rise: 2.0 },
    flaps: [
      { deg: 0, label: 'UP', dCL: 0, alphaShift: 0, dCD: 0, dCm: 0 },
      { deg: 1, label: '1', dCL: 0.2, alphaShift: -3, dCD: 0.004, dCm: -0.01 },
      { deg: 5, label: '5', dCL: 0.4, alphaShift: -3, dCD: 0.01, dCm: -0.025 },
      { deg: 15, label: '15', dCL: 0.68, alphaShift: -2.5, dCD: 0.022, dCm: -0.045 },
      { deg: 30, label: '30', dCL: 0.95, alphaShift: -2, dCD: 0.045, dCm: -0.065 },
      { deg: 40, label: '40', dCL: 1.08, alphaShift: -2, dCD: 0.065, dCm: -0.08 },
    ],
    flapRateDegPerSec: 1.8, flapDrive: 'hydraulic', spoilers: { dCD: 0.05, dCL: 0.35, groundDCL: 0.9, groundDCD: 0.09 },
  },
  controls: { elevatorUpDeg: 25, elevatorDownDeg: 20, aileronDeg: 22, rudderDeg: 28, trimRangeRad: 0.34, trimRatePerSec: 0.05, nosewheelSteerDeg: 7, tillerDeg: 78 },
  fuel: { densityKgL: 0.8, type: 'Jet-A', tanks: [{ name: 'LEFT', capacityL: 4875, unusableL: 20, defaultFrac: 0.95 }, { name: 'RIGHT', capacityL: 4875, unusableL: 20, defaultFrac: 0.95 }, { name: 'CENTER', capacityL: 16270, unusableL: 30, defaultFrac: 0.15 }] },
  limits: { takeoffFlap: 2, Vs0: 110, Vs1: 150, Vr: 145, V2: 152, Vy: 250, Vref: 145, Va: 250, Vmo: 340, Mmo: 0.82, Vne: 340, Vle: 270, Vlo: 235, Vfe: [[1, 250], [5, 250], [15, 200], [30, 175], [40, 162]], cruiseKtas: 453, serviceCeilingFt: 41000 },
  autopilot: { maxBank: 25, maxVs: 6000, at: true, flc: true, app: true, nav: true, autoland: true, pitchRate: 3, rollRate: 5, spdLabel: 'MCP SPD', flcLabel: 'LVL CHG' },
  systems: { pressurization: { maxDiffPsi: 8.35 }, hydraulics: [{ name: 'A', pumps: [{ engine: 0 }, { electric: true }] }, { name: 'B', pumps: [{ engine: 1 }, { electric: true }] }] },
  sound: { profile: 'turbofan', fanBlades: 24 },
  model: { type: 'airliner', variant: 'narrowbody', winglet: 'blended', livery: [0.94, 0.95, 0.96], tail: [0.55, 0.12, 0.12] }, cockpit: { type: 'glass-airliner', input: 'yoke' },
});
