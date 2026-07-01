// Deterministic pseudo-random number generation.
//
// Persistent blood decals must render the *identical* blob shape on every
// client and after a reload. Math.random() can't do that, so each persisted
// decal carries a numeric seed and is drawn through a mulberry32 generator
// seeded from it. Live-only effects (e.g. the animated bleeding overlay) keep
// using Math.random via the default generator below.

// Small, fast, well-distributed 32-bit PRNG. Returns a function producing
// floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A fresh 32-bit seed for a new decal.
export function makeSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

// The default generator used by live effects — just Math.random.
export const defaultRng = Math.random;

// rand(min, max) using a supplied generator (defaults to Math.random).
export function randWith(rng, min, max) {
  return min + (rng() * (max - min));
}
