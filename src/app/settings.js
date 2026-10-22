// Persistent user settings (localStorage, guarded: works without storage).
const KEY = 'wfs.settings.v1';

export const DEFAULTS = {
  aircraft: 'ga172',
  airport: 'KSFO',
  spawn: '',            // spawn id from Airport.spawnPoints(), '' = first runway
  startMode: 'runway',  // runway | parking | approach
  approachNm: 3,
  coldDark: false,
  weatherPreset: 'breezy',
  weather: {},          // overrides of preset fields
  localHour: 10.5,
  dayOfYear: 172,
  damageMode: 'realistic',
  autoRudder: false,
  graphics: 'medium',
  online: true,
  sensitivity: 1,
  volume: 0.8,
  hud: true,
  dynamicResolution: true,
  touchControls: 'auto', // auto | on | off
  touchInvertPitch: false,
};

export function loadSettings() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }

export const GRAPHICS = {
  low: { label: 'Low', pixelRatio: 0.75, shadows: 0, terrain: 'low', scenery: 'low', antialias: false },
  medium: { label: 'Medium', pixelRatio: 1, shadows: 1024, terrain: 'medium', scenery: 'medium', antialias: true },
  high: { label: 'High', pixelRatio: 1.5, shadows: 2048, terrain: 'high', scenery: 'high', antialias: true },
  ultra: { label: 'Ultra', pixelRatio: 2, shadows: 4096, terrain: 'ultra', scenery: 'ultra', antialias: true },
};

/** UTC Date for a local solar hour at a longitude on a given day of year (current year). */
export function utcFromLocal(localHour, lon, dayOfYear) {
  const y = new Date().getUTCFullYear();
  const utcH = localHour - lon / 15;
  return new Date(Date.UTC(y, 0, 1) + (dayOfYear - 1) * 86400000 + utcH * 3600000);
}
