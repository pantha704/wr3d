/**
 * Arena: movement, strike geometry and a match loop at the shipped 18 Hz tick.
 *
 * Simplification vs the reference (spec §2, §4): the original resolves hits on
 * animation frames with a per-anim range/angle/pain table. We resolve on a
 * short wind-up + a single geometry test using the same cone rule:
 *     hit  <=>  dist <= range * 0.9  &&  |angleErr| <= 25° * (range / dist)
 * The table-driven version replaces `STRIKE` below once the move catalogue
 * lands; the tick, pools and damage math already match.
 *
 * ponytail: one generic strike + one grapple; per-move tables when the
 * catalogue exists.
 */
import { STAT, strikeDamage, contestChance } from './formulas';
import { applyStrike, tickFrame, type Fighter, type MatchState } from './match';
import type { Rng } from './prng';

export const ARENA_RADIUS = 5.2;
export const STRIKE = {
  range: 1.9,
  windupFrames: 3,
  recoveryFrames: 6,
  multiplier: 2,
  arcDeg: 25,
} as const;

export interface Intent {
  /** -1..1, strafe across the arena */
  moveX: number;
  moveZ: number;
  strike: boolean;
  grapple: boolean;
}

export const IDLE: Intent = { moveX: 0, moveZ: 0, strike: false, grapple: false };

interface Combat {
  windup: number;
  recovery: number;
  grappleCooldown: number;
}

export interface Arena {
  match: MatchState;
  combat: [Combat, Combat];
  /** events since last drain, for HUD/log */
  events: string[];
}

export function createArenaFromMatch(match: MatchState): Arena {
  return {
    match,
    combat: [
      { windup: 0, recovery: 0, grappleCooldown: 0 },
      { windup: 0, recovery: 0, grappleCooldown: 0 },
    ],
    events: [],
  };
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

function moveSpeed(f: Fighter): number {
  // spec §3: travel scales with Agility (stat 4)
  return 0.9 + (f.stats[STAT.Agility]! / 100) * 2.1; // m/s
}

function stepMovement(f: Fighter, intent: Intent): void {
  const mag = Math.hypot(intent.moveX, intent.moveZ);
  if (mag < 0.01) return;
  const speed = moveSpeed(f) / 18; // per tick
  f.x += (intent.moveX / mag) * speed;
  f.z += (intent.moveZ / mag) * speed;
  const r = Math.hypot(f.x, f.z);
  if (r > ARENA_RADIUS) {
    f.x = (f.x / r) * ARENA_RADIUS;
    f.z = (f.z / r) * ARENA_RADIUS;
  }
}

/** Face the opponent when not actively moving away. */
function faceOpponent(f: Fighter, other: Fighter, intent: Intent): void {
  if (Math.hypot(intent.moveX, intent.moveZ) > 0.5) return;
  f.facing = Math.atan2(other.z - f.z, other.x - f.x);
}

function inCone(attacker: Fighter, target: Fighter): { dist: number; ok: boolean } {
  const dx = target.x - attacker.x;
  const dz = target.z - attacker.z;
  const dist = Math.hypot(dx, dz);
  if (dist > STRIKE.range) return { dist, ok: false };
  const angleErr = Math.abs(wrap(Math.atan2(dz, dx) - attacker.facing)) * (180 / Math.PI);
  const allowed = STRIKE.arcDeg * (STRIKE.range / Math.max(dist, 0.35));
  return { dist, ok: dist <= STRIKE.range * 0.9 && angleErr <= allowed };
}

function beginStrike(a: Fighter, c: Combat, target: Fighter): void {
  if (c.windup > 0 || c.recovery > 0) return;
  const { dist } = inCone(a, target);
  if (dist > STRIKE.range * 1.35) return; // out of range entirely
  c.windup = STRIKE.windupFrames;
}

function resolveStrike(a: Fighter, d: Fighter, c: Combat, rng: Rng, events: string[]): void {
  const { ok } = inCone(a, d);
  if (!ok) {
    events.push(`${a.name} swings wide`);
  } else {
    const res = applyStrike(a, d, STRIKE.multiplier, rng);
    events.push(
      `${a.name} connects — ${res.damage} dmg` + (res.knockedDown ? ' · KNOCKDOWN' : ''),
    );
  }
  c.recovery = STRIKE.recoveryFrames;
}

/** One fixed tick. Intents are indexed by fighter slot (0 or 1). */
export function stepArena(arena: Arena, intents: [Intent, Intent], rng: Rng): void {
  const [f0, f1] = arena.match.fighters;
  if (arena.match.over) return;

  arena.match.frame += 1;
  for (let i = 0; i < 2; i++) {
    const me = arena.match.fighters[i]!;
    const other = arena.match.fighters[i === 0 ? 1 : 0]!;
    const intent = intents[i]!;
    const c = arena.combat[i]!;

    stepMovement(me, intent);
    faceOpponent(me, other, intent);
    tickFrame(me);

    if (c.windup > 0) {
      c.windup -= 1;
      if (c.windup === 0) resolveStrike(me, other, c, rng, arena.events);
    } else if (c.recovery > 0) {
      c.recovery -= 1;
    } else if (intent.strike) {
      beginStrike(me, c, other);
    }

    // grapple: a single contest, mirrors the reference's universal template
    if (c.grappleCooldown > 0) c.grappleCooldown -= 1;
    if (intent.grapple && c.grappleCooldown === 0) {
      const dist = Math.hypot(other.x - me.x, other.z - me.z);
      if (dist < 1.3) {
        const chance = contestChance(me.stats[STAT.Skill]!, other.stats[STAT.Skill]!, 1);
        const roll = rng() * 300;
        if (roll < chance) {
          applyStrike(me, other, STRIKE.multiplier * 2.5, rng);
          arena.events.push(`${me.name} lands a grapple`);
        } else {
          arena.events.push(`${me.name} is reversed`);
        }
        c.grappleCooldown = 24;
      }
    }
  }

  const loser = arena.match.fighters.find((f) => f.health <= 0);
  if (loser) {
    arena.match.over = true;
    arena.match.winner = arena.match.fighters.find((f) => f.id !== loser.id) ?? null;
    arena.events.push(`${arena.match.winner?.name ?? 'nobody'} wins by KO`);
  }
}

export function drainEvents(arena: Arena): string[] {
  const out = arena.events.slice();
  arena.events.length = 0;
  return out;
}
