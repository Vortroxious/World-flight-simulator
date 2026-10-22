// Unit conversions.
export const KT = 0.514444; // m/s per knot
export const FT = 0.3048; // m per foot
export const NM = 1852; // m per nautical mile
export const LB = 0.45359237; // kg per pound
export const GAL = 3.785411784; // litres per US gallon
export const HP = 745.699872; // W per horsepower
export const INHG = 3386.389; // Pa per inHg
export const G0 = 9.80665;
export const toKt = (ms) => ms / KT;
export const toFt = (m) => m / FT;
export const toFpm = (ms) => (ms / FT) * 60;
