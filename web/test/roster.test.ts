import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const GENERATED = join(ROOT, 'shared', 'data', 'roster.generated.json');
const PRIVATE = join(ROOT, 'private', 'roster.json');

const STATS = ['Popularity', 'Strength', 'Skill', 'Agility', 'Stamina', 'Toughness', 'Attitude', 'Happiness'];

type Fighter = {
  id: number;
  name: string;
  team: string;
  age: number;
  build: number;
  height: number;
  stats: Record<string, number>;
  moves: Record<string, unknown>;
};

const roster = JSON.parse(readFileSync(GENERATED, 'utf8')) as Fighter[];

describe('shipped roster', () => {
  it('has 300 entries with unique names', () => {
    expect(roster).toHaveLength(300);
    expect(new Set(roster.map((f) => f.name)).size).toBe(300);
  });

  it('has every stat in the documented 0-100 band', () => {
    for (const f of roster) {
      for (const s of STATS) {
        const v = f.stats[s];
        expect(typeof v, `${f.name}.${s}`).toBe('number');
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(100);
      }
    }
  });

  it('keeps age, build and height inside the ranges the sim accepts', () => {
    for (const f of roster) {
      expect(f.age).toBeGreaterThanOrEqual(18);
      expect(f.age).toBeLessThanOrEqual(60);
      expect(f.build).toBeGreaterThanOrEqual(1);
      expect(f.build).toBeLessThanOrEqual(9);
      expect(f.height).toBeGreaterThanOrEqual(90);
      expect(f.height).toBeLessThanOrEqual(110);
    }
  });

  // R1 countermeasure: the public data must never overlap the extracted roster.
  // private/ is gitignored, so on CI this guards nothing — locally it is the
  // check that stops an accidental copy-paste from the analysed binary.
  it('shares no name with the private reference roster', () => {
    if (!existsSync(PRIVATE)) {
      expect(true).toBe(true);
      return;
    }
    const reference = JSON.parse(readFileSync(PRIVATE, 'utf8')) as { name: string }[];
    const refNames = new Set(reference.map((f) => f.name.trim().toLowerCase()));
    const collisions = roster.filter((f) => refNames.has(f.name.trim().toLowerCase()));
    expect(collisions.map((c) => c.name)).toEqual([]);
  });
});
