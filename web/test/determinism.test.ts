import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SIM_DIR = join(import.meta.dirname, '..', 'src', 'sim');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Strip comments so prose about Math.random() is not mistaken for a call. */
function code(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// R3 countermeasure: one seeded PRNG only. An accidental Math.random() in the
// sim makes replays, tests and the Roblox parity guarantee meaningless.
describe('sim determinism', () => {
  it('never calls Math.random()', () => {
    const offenders = walk(SIM_DIR).filter((file) => /Math\.random\s*\(/.test(code(file)));
    expect(offenders).toEqual([]);
  });
});
