/** Mulberry32. Returns a function that yields values in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  rng.getState = () => a >>> 0;
  return rng;
}

export function rngFrom(seed) {
  if (typeof seed === "function") return seed;
  if (typeof seed === "number" && Number.isFinite(seed)) return mulberry32(seed);
  return mulberry32((Math.random() * 0x100000000) >>> 0);
}

export function gaussian(rng) {
  let u = 1 - rng();
  let v = 1 - rng();
  if (u < 1e-12) u = 1e-12;
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
