// Surface friction/roughness properties for ground contact.
export const SURFACES = {
  runway:   { mu: 0.8, roll: 1.0, rough: 0.0, hard: true, name: 'Runway' },
  paved:    { mu: 0.75, roll: 1.0, rough: 0.005, hard: true, name: 'Taxiway/apron' },
  grass:    { mu: 0.5, roll: 3.0, rough: 0.03, hard: false, name: 'Grass' },
  terrain:  { mu: 0.55, roll: 6.0, rough: 0.09, hard: false, name: 'Rough terrain' },
  water:    { mu: 0.05, roll: 0, rough: 0, hard: false, water: true, name: 'Water' },
  building: { mu: 0.6, roll: 0, rough: 0, hard: true, name: 'Building' },
  tree:     { mu: 0.4, roll: 0, rough: 0, hard: false, name: 'Trees' },
};
export const surfaceOf = (name) => SURFACES[name] || SURFACES.terrain;
