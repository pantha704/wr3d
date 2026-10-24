/**
 * Opponent AI. Deliberately small: close the distance, strike on a cooldown,
 * grapple when very close. Skill gates how often it commits, so a high-Skill
 * wrestler pressures more without any extra code.
 *
 * ponytail: no state machine, no difficulty tiers. Add when playtesting says so.
 */
import { STAT } from './formulas';
import type { Fighter } from './match';
import type { Intent } from './arena';

export interface AiMemory {
  cooldown: number;
  jitter: number;
}

export function createAiMemory(): AiMemory {
  return { cooldown: 0, jitter: 0 };
}

export function aiIntent(
  me: Fighter,
  target: Fighter,
  mem: AiMemory,
  rand: () => number,
): Intent {
  const dx = target.x - me.x;
  const dz = target.z - me.z;
  const dist = Math.hypot(dx, dz) || 1;

  mem.cooldown = Math.max(0, mem.cooldown - 1);
  mem.jitter = mem.jitter > 0 ? mem.jitter - 1 : 0;

  const skill = me.stats[STAT.Skill]!;
  const aggression = 0.55 + skill / 250; // 0.79 .. 0.93
  const reach = 1.6;

  if (dist > reach) {
    // approach, with a small lateral wobble so it is not a straight line
    const wobble = mem.jitter > 0 ? 0.35 : 0;
    return { moveX: dx / dist, moveZ: dz / dist + wobble, strike: false, grapple: false };
  }

  if (mem.cooldown === 0 && rand() < aggression) {
    mem.cooldown = Math.round(10 + (1 - skill / 100) * 12);
    mem.jitter = 6;
    const grapple = dist < 1.15 && rand() < 0.25;
    return { moveX: 0, moveZ: 0, strike: !grapple, grapple };
  }

  return { moveX: 0, moveZ: 0, strike: false, grapple: false };
}
