import { describe, expect, it } from 'vitest';
import { createArenaFromMatch, stepArena, STRIKE, ARENA_RADIUS } from '../src/sim/arena';
import { createMatch, type MatchState } from '../src/sim/match';
import { aiIntent, createAiMemory } from '../src/sim/ai';
import { mulberry32 } from '../src/sim/prng';
import { STAT } from '../src/sim/formulas';

function stats(over: Partial<Record<string, number>> = {}): number[] {
  const v = new Array(9).fill(0);
  v[STAT.Popularity] = 70;
  v[STAT.Strength] = over.Strength ?? 75;
  v[STAT.Skill] = over.Skill ?? 75;
  v[STAT.Agility] = over.Agility ?? 75;
  v[STAT.Stamina] = 70;
  v[STAT.Toughness] = over.Toughness ?? 75;
  v[STAT.Attitude] = 75;
  v[STAT.Happiness] = 75;
  return v;
}

function freshMatch(): MatchState {
  return createMatch(
    { id: 1, name: 'Alpha', stats: stats() },
    { id: 2, name: 'Bravo', stats: stats() },
  );
}

describe('arena', () => {
  it('spawns fighters inside the ring, facing each other', () => {
    const m = freshMatch();
    for (const f of m.fighters) expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(ARENA_RADIUS);
    expect(m.fighters[0]!.x).toBeLessThan(0);
    expect(m.fighters[1]!.x).toBeGreaterThan(0);
  });

  it('keeps fighters inside the ring no matter how hard they push', () => {
    const m = freshMatch();
    const a = createArenaFromMatch(m);
    const rng = mulberry32(7);
    for (let i = 0; i < 400; i++) {
      stepArena(a, [
        { moveX: 1, moveZ: 0, strike: false, grapple: false },
        { moveX: 1, moveZ: 0, strike: false, grapple: false },
      ], rng);
    }
    for (const f of m.fighters) expect(Math.hypot(f.x, f.z)).toBeLessThanOrEqual(ARENA_RADIUS + 1e-9);
  });

  it('lands damage only inside the strike cone', () => {
    const m = freshMatch();
    const a = createArenaFromMatch(m);
    const rng = mulberry32(11);
    const [p1, p2] = m.fighters;
    p1!.x = 0;
    p1!.z = 0;
    p2!.x = 4.5; // far outside STRIKE.range
    p2!.z = 0;
    p1!.facing = 0;

    for (let i = 0; i < STRIKE.windupFrames + 2; i++) {
      stepArena(a, [{ moveX: 0, moveZ: 0, strike: true, grapple: false }, { moveX: 0, moveZ: 0, strike: false, grapple: false }], rng);
    }
    expect(p2!.health).toBe(p2!.maxHealth);
  });

  it('resolves a full AI-vs-AI match to a winner, deterministically', () => {
    function run(seed: number) {
      const m = freshMatch();
      const a = createArenaFromMatch(m);
      const rng = mulberry32(seed);
      const mem = [createAiMemory(), createAiMemory()];
      const aiRng = mulberry32(seed + 1);
      for (let i = 0; i < 18 * 60 * 5 && !m.over; i++) {
        stepArena(a, [
          aiIntent(m.fighters[0]!, m.fighters[1]!, mem[0]!, aiRng),
          aiIntent(m.fighters[1]!, m.fighters[0]!, mem[1]!, aiRng),
        ], rng);
      }
      return { winner: m.winner?.name ?? null, frame: m.frame, hp: m.fighters.map((f) => f.health) };
    }
    const a = run(99);
    const b = run(99);
    expect(a).toEqual(b);              // deterministic
    expect(a.winner).not.toBeNull();   // someone actually wins within 5 simulated minutes
  });
});
