// Exterior model factory: the GA-172 keeps its hand-shaped model; every other aircraft is built parametrically
// from its configuration.
import { AircraftModel } from '../aircraft-model.js';
import { ParametricModel } from './parametric.js';

export function createAircraftModel(cfg) {
  return cfg.model?.type ? new ParametricModel(cfg) : new AircraftModel();
}
