// Engine factory.
import { PistonEngine } from './piston.js';
import { TurbofanEngine } from './turbofan.js';
import { TurbopropEngine } from './turboprop.js';

export function makeEngine(cfg) {
  switch (cfg.type) {
    case 'piston': return new PistonEngine(cfg);
    case 'turbofan': return new TurbofanEngine(cfg);
    case 'turboprop': return new TurbopropEngine(cfg);
    default: throw new Error('unknown engine type ' + cfg.type);
  }
}
export { PistonEngine, TurbofanEngine, TurbopropEngine };
