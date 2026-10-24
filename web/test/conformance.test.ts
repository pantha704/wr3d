import { describe, expect, it } from 'vitest';
import vectors from '../../shared/vectors/conformance.json';
import { mulberry32, Rnd, jsRound } from '../src/sim/prng';
import {
  charWorth,
  contestChance,
  healthPool,
  poiseDamage,
  specialMeter,
  strikeDamage,
  DEFAULT_OPT_LENGTH,
} from '../src/sim/formulas';

const V = vectors.vectors as any;

describe('PRNG + Rnd', () => {
  it('matches mulberry32 goldens and endpoint weighting', () => {
    for (const seedCase of V.rnd.seeds) {
      const rng = mulberry32(seedCase.seed);
      const got = Array.from({ length: 10 }, () => Rnd(rng, seedCase.lo, seedCase.hi));
      expect(got).toEqual(seedCase.first10);
    }
  });

  it('jsRound is half-up, not banker’s', () => {
    expect(jsRound(0.5)).toBe(1);
    expect(jsRound(1.5)).toBe(2);
    expect(jsRound(2.5)).toBe(3);
  });
});

describe('health pool', () => {
  it('defaults to optLength 2 → 10,000 HP', () => {
    expect(healthPool()).toBe(10_000);
    expect(healthPool(DEFAULT_OPT_LENGTH)).toBe(10_000);
    expect(healthPool(1)).toBe(5_000);
  });
});

describe('strike damage', () => {
  it('reproduces every vector', () => {
    for (const c of V.strike_damage.cases) {
      const stats = [0, 0, c.strength, 0, 0, 0, 0, 0, 0];
      expect(strikeDamage(stats, c.mult, c.special)).toBe(c.expected);
    }
  });
});

describe('poise', () => {
  it('reproduces every vector', () => {
    for (const c of V.poise.cases) {
      expect(poiseDamage(c.pain, c.toughness)).toBeCloseTo(c.expected, 9);
    }
  });
});

describe('special meter', () => {
  it('reproduces every vector (rng advances per case)', () => {
    const seed = V.special_meter.cases[0].seed as number;
    const rng = mulberry32(seed);
    for (const c of V.special_meter.cases) {
      const roll = Rnd(rng, 0, 100);
      expect(specialMeter(c.popularity, roll)).toBe(c.expected);
    }
  });
});

describe('contest chance', () => {
  it('reproduces every vector', () => {
    for (const c of V.contest_chance.cases) {
      expect(contestChance(c.atkStat, c.defSkill, c.sizeDiff, c.runUp)).toBeCloseTo(c.expected, 9);
    }
  });
});

describe('character worth', () => {
  it('reproduces every vector', () => {
    for (const c of V.char_worth.cases) {
      const got = charWorth({
        statAverage: c.statAvg,
        fed: c.fed,
        injured: c.injured,
        championship: c.champ,
        booker: c.booker,
      });
      expect(got, JSON.stringify(c)).toBe(c.expected);
    }
  });
});
