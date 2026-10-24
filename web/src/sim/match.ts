/**
 * Headless match state. No rendering, no input — pure simulation, so it can be
 * unit-tested and later mirrored in Luau.
 *
 * Pools (MainTimeline.as):
 *   pHealth  — 10,000 by default (optLength 2 x 5000, line 53739)
 *   pHP      — poise, the knockdown gate; starts 1000, cap health/5 (line 97219)
 *   pDT      — down timer, set from pain (line 97218)
 */
import type { Rng } from './prng';
import {
  DEFAULT_OPT_LENGTH,
  FRAME_RATE,
  STAT,
  healthPool,
  poiseDamage,
  poiseCap,
  rescaleStats,
  strikeDamage,
  type StatVector,
} from './formulas';

export interface FighterInit {
  id: number;
  name: string;
  stats: StatVector; // 1-indexed, 9 slots
  charHealth?: number; // 0-100, from character data
  optLength?: number;
}

export interface Fighter {
  id: number;
  name: string;
  charStats: StatVector;
  stats: StatVector; // live, rescaled per frame
  health: number;
  maxHealth: number;
  poise: number;
  downTimer: number;
  special: number;
  knockedDown: boolean;
}

export const POISE_START = 1000;

export function createFighter(init: FighterInit): Fighter {
  const maxHealth = healthPool(init.optLength ?? DEFAULT_OPT_LENGTH, init.charHealth ?? 100);
  return {
    id: init.id,
    name: init.name,
    charStats: init.stats,
    stats: init.stats.slice() as number[],
    health: maxHealth,
    maxHealth,
    poise: POISE_START,
    downTimer: 0,
    special: 0,
    knockedDown: false,
  };
}

export interface StrikeResult {
  damage: number;
  poiseLoss: number;
  knockedDown: boolean;
  healthAfter: number;
  poiseAfter: number;
}

/**
 * Apply a strike. Mirrors the shipped order of operations:
 * pain first (97003), health second (97217), down-timer (97218), poise (97219).
 * A knockdown happens when poise hits zero — health is not the gate.
 */
export function applyStrike(
  attacker: Fighter,
  defender: Fighter,
  animMultiplier: number,
  rng: Rng,
): StrikeResult {
  void rng; // reserved: the original rolls several sub-effects here
  const pain = strikeDamage(attacker.stats, animMultiplier, attacker.special > 0);

  defender.health = Math.max(0, defender.health - pain);
  defender.downTimer = pain; // GetDT(v, pain) — full formula lands in the spec, §1.4
  defender.poise -= poiseDamage(pain, defender.stats[STAT.Toughness]!);

  const cap = poiseCap(defender.health);
  if (defender.poise > cap) defender.poise = cap;

  let knockedDown = false;
  if (defender.poise <= 0) {
    knockedDown = true;
    defender.knockedDown = true;
  }

  return {
    damage: pain,
    poiseLoss: poiseDamage(pain, defender.stats[STAT.Toughness]!),
    knockedDown,
    healthAfter: defender.health,
    poiseAfter: defender.poise,
  };
}

/** Per-frame upkeep: rescale physical stats against current health (56024-56051). */
export function tickFrame(f: Fighter): void {
  const pct = f.maxHealth > 0 ? (f.health / f.maxHealth) * 100 : 0;
  f.stats = rescaleStats(f.charStats, pct, f.special > 0) as StatVector;
  if (f.downTimer > 0) f.downTimer -= 1;
}

/** Frames of a 3-count pin: pCountTim > 25, three times (line 46913). */
export const PIN_FRAMES = 3 * 26;
export const PIN_SECONDS = PIN_FRAMES / FRAME_RATE;

export interface MatchState {
  fighters: [Fighter, Fighter];
  frame: number;
  over: boolean;
  winner: Fighter | null;
  log: string[];
}

export function createMatch(a: FighterInit, b: FighterInit): MatchState {
  return {
    fighters: [createFighter(a), createFighter(b)],
    frame: 0,
    over: false,
    winner: null,
    log: [],
  };
}

/** Advance one simulation frame at the shipped 18 Hz tick. */
export function stepMatch(state: MatchState): void {
  if (state.over) return;
  state.frame += 1;
  for (const f of state.fighters) tickFrame(f);

  const loser = state.fighters.find((f) => f.health <= 0);
  if (loser) {
    state.over = true;
    state.winner = state.fighters.find((f) => f.id !== loser.id) ?? null;
    state.log.push(`frame ${state.frame}: ${loser.name} at 0 health`);
  }
}
