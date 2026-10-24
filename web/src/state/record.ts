/**
 * Match record persisted in localStorage. Small on purpose: the game has no
 * career mode yet, so a full IndexedDB save would be speculative.
 *
 * Versioned envelope so a future save format can migrate instead of wiping.
 * ponytail: localStorage + {v,t} envelope; move to IndexedDB when career saves land.
 */
export const KEY = 'wr3d.record.v1';

export interface MatchRecord {
  wins: number;
  losses: number;
  lastOpponent: string | null;
}

export const EMPTY: MatchRecord = { wins: 0, losses: 0, lastOpponent: null };

type Envelope = { v: 1; t: MatchRecord };

export function load(store: Pick<Storage, 'getItem'>): MatchRecord {
  try {
    const raw = store.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Envelope;
    if (parsed.v !== 1 || typeof parsed.t !== 'object' || parsed.t === null) return { ...EMPTY };
    const { wins, losses, lastOpponent } = parsed.t;
    if (!Number.isFinite(wins) || !Number.isFinite(losses)) return { ...EMPTY };
    return {
      wins: Math.max(0, Math.floor(wins)),
      losses: Math.max(0, Math.floor(losses)),
      lastOpponent: typeof lastOpponent === 'string' ? lastOpponent : null,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function save(store: Pick<Storage, 'setItem'>, rec: MatchRecord): void {
  try {
    store.setItem(KEY, JSON.stringify({ v: 1, t: rec } satisfies Envelope));
  } catch {
    /* private mode / quota — the match simply does not persist */
  }
}

export function applyResult(rec: MatchRecord, won: boolean, opponent: string): MatchRecord {
  return {
    wins: rec.wins + (won ? 1 : 0),
    losses: rec.losses + (won ? 0 : 1),
    lastOpponent: opponent,
  };
}
