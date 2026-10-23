// Aircraft registry: every flyable aircraft, in menu order.
import ga172 from './ga172/config.json';
import kingair from './kingair/config.js';
import a320 from './a320/config.js';
import b737 from './b737/config.js';
import b787 from './b787/config.js';
import a350 from './a350/config.js';
import fighter from './fighter/config.js';
import cargo from './cargo/config.js';

export const AIRCRAFT = { ga172, kingair, a320, b737, b787, a350, fighter, cargo };
export const AIRCRAFT_IDS = Object.keys(AIRCRAFT);
