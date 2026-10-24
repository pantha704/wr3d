/**
 * Deterministic PRNG. The original ActionScript calls unseeded Math.random()
 * inline; a port that does the same cannot be tested. One seeded generator,
 * used everywhere, keeps both the web and Roblox builds reproducible.
 *
 * mulberry32 — must stay bit-identical to tools/gen_vectors.py and the Luau port.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + (Math.imul(t ^ (t >>> 7), t | 61) >>> 0))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** ActionScript Math.round: half-up toward +Infinity (JS Math.round agrees for x >= 0). */
export function jsRound(x: number): number {
  return Math.floor(x + 0.5);
}

/**
 * MainTimeline.as:3313
 *   var returner:int = Math.round(Math.random() * (max - min));
 *   return int(returner + min);
 * Endpoints receive half weight — this is not `min + floor(r * (max-min+1))`.
 */
export function Rnd(rng: Rng, min: number, max: number): number {
  return jsRound(rng() * (max - min)) + min;
}

/** MainTimeline.as:3317 — pick one of two values. */
export function RndOr(rng: Rng, optionA: number, optionB: number): number {
  return jsRound(rng()) === 0 ? optionA : optionB;
}
