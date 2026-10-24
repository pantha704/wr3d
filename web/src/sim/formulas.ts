/**
 * Core formulas, transcribed from the decompiled ActionScript.
 * Every function cites its source line in `Game_fla/MainTimeline.as`.
 */

/** Stat indices — MainTimeline.as:131372 textStat */
export const STAT = {
  Popularity: 1,
  Strength: 2,
  Skill: 3,
  Agility: 4,
  Stamina: 5,
  Toughness: 6,
  Attitude: 7,
  Happiness: 8,
} as const;

/** 1-indexed stat vector, matching the source. Index 0 is unused. */
export type StatVector = readonly number[];

export const DEFAULT_OPT_LENGTH = 2; // MainTimeline.as:131183
export const HP_PER_LENGTH = 5000; // MainTimeline.as:53739 / 55389
export const FRAME_RATE = 18; // MainTimeline.as:131192

/**
 * MainTimeline.as:53739 — this.pHealth[cyc] = this.optLength * 5000
 * then scaled by charHealth/100 (55398). Default optLength is 2 → 10,000 HP.
 */
export function healthPool(optLength: number = DEFAULT_OPT_LENGTH, charHealth = 100): number {
  const base = optLength * HP_PER_LENGTH;
  return Math.trunc(base * (charHealth / 100));
}

/**
 * MainTimeline.as:97003 — pain = Math.round(pStat[cyc][Strength] * pain)
 * with a 1.25x multiplier while the special meter is active (97004-97007).
 */
export function strikeDamage(stats: StatVector, animMultiplier: number, specialActive = false): number {
  const raw = stats[STAT.Strength]! * animMultiplier;
  const pain = Math.floor(raw + 0.5);
  return specialActive ? Math.floor(pain * 1.25 + 0.5) : pain;
}

/**
 * MainTimeline.as:97219 — this.pHP[v] -= pain / 50 * (150 - pStat[v][Toughness])
 * Poise is the knockdown gate: starts at 1000, capped at health/5.
 */
export function poiseDamage(pain: number, toughness: number): number {
  return (pain / 50) * (150 - toughness);
}

export function poiseCap(health: number): number {
  return health / 5;
}

/**
 * MainTimeline.as:57230 — pSpecial[cyc] = 100 + pStat[cyc][Popularity] + Rnd(0,100)
 */
export function specialMeter(popularity: number, roll: number): number {
  return 100 + popularity + roll;
}

/**
 * MainTimeline.as:67944-67958 — universal contest template:
 *   chance = attackerStat
 *   chance += 150 - defenderSkill
 *   chance *= SizeDifference(cyc, v)
 *   chance *= 0.75 when either side is in a run-up
 * style: 0 → Skill, 1 → Strength, 2 → Agility (all defended with Skill).
 */
export function contestChance(
  attackerStat: number,
  defenderSkill: number,
  sizeDifference: number,
  runUp = false,
): number {
  let chance = attackerStat + (150 - defenderSkill);
  chance *= sizeDifference;
  if (runUp) chance *= 0.75;
  return chance;
}

/**
 * MainTimeline.as:114779-114821 — CalculateWorth
 *   chunk = max(15, StatAverage(char,1) - 40)
 *   worth = chunk^3 / 15
 *   fed 7 ×0.5 · fed 8 ×1.5 · injured ×0.75 · champion ×1.5 · minor champ ×1.25
 *   booker ×1.5 · RoundOff(_,10) · floor 100
 */
export interface WorthInput {
  statAverage: number;
  fed?: number;
  injured?: boolean;
  championship?: 0 | 1 | 2 | 3;
  booker?: boolean;
}

export function charWorth(input: WorthInput): number {
  const { statAverage, fed = 0, injured = false, championship = 0, booker = false } = input;
  const chunk = Math.max(15, statAverage - 40);
  let worth = chunk * chunk * (chunk / 15);
  if (fed === 7) worth /= 2;
  if (fed === 8) worth *= 1.5;
  if (injured) worth *= 0.75;
  if (championship === 1) worth *= 1.5;
  if (championship === 2 || championship === 3) worth *= 1.25;
  if (booker) worth *= 1.5;
  const rounded = Math.floor(worth / 10 + 0.5) * 10;
  return Math.max(100, rounded);
}

/**
 * MainTimeline.as:56024-56051 — live stat rescaling, recomputed every frame.
 * Physical stats (2..6) = min(98, charStat * (0.75 + healthPercent / 4)),
 * or 1.25x that while the special meter is active.
 */
export function rescaleStats(
  charStats: StatVector,
  healthPercent: number,
  specialActive = false,
): number[] {
  const out = charStats.slice() as number[];
  for (let i = STAT.Strength; i <= STAT.Toughness; i++) {
    const base = charStats[i]! * (0.75 + healthPercent / 4);
    out[i] = Math.min(98, Math.trunc((specialActive ? base * 1.25 : base) * 1000) / 1000);
  }
  return out;
}
