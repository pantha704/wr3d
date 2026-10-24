import { describe, expect, it } from 'vitest';
import { EMPTY, KEY, applyResult, load, save } from '../src/state/record';

function memoryStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    dump: () => Object.fromEntries(map),
  };
}

describe('match record', () => {
  it('starts empty when nothing is stored', () => {
    expect(load(memoryStore())).toEqual(EMPTY);
  });

  it('round-trips through a versioned envelope', () => {
    const store = memoryStore();
    save(store, { wins: 3, losses: 1, lastOpponent: 'Ismail Kaur' });
    expect(store.dump()[KEY]).toContain('"v":1');
    expect(load(store)).toEqual({ wins: 3, losses: 1, lastOpponent: 'Ismail Kaur' });
  });

  it('survives corrupt or foreign-shaped data instead of throwing', () => {
    expect(load(memoryStore({ [KEY]: 'not json' }))).toEqual(EMPTY);
    expect(load(memoryStore({ [KEY]: '{"v":2,"t":{"wins":9}}' }))).toEqual(EMPTY);
    expect(load(memoryStore({ [KEY]: '{"v":1,"t":{"wins":"x","losses":1}}' }))).toEqual(EMPTY);
  });

  it('does not let storage failures escape', () => {
    const hostile = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(load(hostile)).toEqual(EMPTY);
    expect(() => save(hostile, EMPTY)).not.toThrow();
  });

  it('counts a result once', () => {
    const after = applyResult(applyResult(EMPTY, true, 'A'), false, 'B');
    expect(after).toEqual({ wins: 1, losses: 1, lastOpponent: 'B' });
  });
});
