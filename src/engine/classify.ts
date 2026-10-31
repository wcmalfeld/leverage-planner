/**
 * Tiering: separates protected high-leverage work from maintenance, low-leverage
 * obligations, optional items and things worth reducing — and flags "busywork":
 * tasks that look productive but barely connect to stated goals.
 */
import type { Goal, Task, Tier } from '../domain/types';
import type { ScoreResult } from './scoring';

export const TIER_INFO: Record<Tier, { label: string; short: string; advice: string }> = {
  protect: {
    label: 'High-leverage — protect',
    short: 'Protect',
    advice: 'Give this your best hours and defend the block.',
  },
  maintain: {
    label: 'Important maintenance',
    short: 'Maintain',
    advice: 'Keeps the foundation healthy. Schedule it consistently, but cap it.',
  },
  obligation: {
    label: 'Necessary, low leverage',
    short: 'Obligation',
    advice: 'Do it efficiently — batch it, timebox it, keep it out of peak hours.',
  },
  optional: {
    label: 'Optional — can wait',
    short: 'Optional',
    advice: 'Fine to defer when the day is full.',
  },
  reduce: {
    label: 'Reduce, automate or drop',
    short: 'Reduce',
    advice: 'Weak link to your goals. Eliminate, automate, delegate or shrink it.',
  },
};

export interface Classification {
  tier: Tier;
  reason: string;
  busywork: boolean;
  busyworkReason?: string;
  overridden: boolean;
}

const factor = (r: ScoreResult, key: string) => r.factors.find((f) => f.key === key)!.value;

export function classifyTask(task: Task, result: ScoreResult, goals: Goal[]): Classification {
  const align = factor(result, 'alignment');
  const impact = factor(result, 'impact');
  const compounding = factor(result, 'compounding');
  const urgency = factor(result, 'urgency');
  const linked = goals.filter((g) => task.goalIds.includes(g.id));
  const sustaining = linked.some((g) => g.sustaining);
  const duration = task.durationMin ?? 0;

  const busywork = align < 0.4 && duration >= 45 && impact <= 0.5;
  const busyworkReason = busywork
    ? linked.length === 0
      ? `Takes ${duration} min but isn't linked to any goal`
      : `Takes ${duration} min but only serves a low-priority goal`
    : undefined;

  let tier: Tier;
  let reason: string;

  if (task.tierOverride) {
    return { tier: task.tierOverride, reason: 'Set by you', busywork, busyworkReason, overridden: true };
  }

  if (linked.length === 0 && impact <= 0.5) {
    tier = 'reduce';
    reason = 'No goal link and modest impact';
  } else if (task.removesBottleneck || (result.score >= 62 && align >= 0.55 && impact >= 0.5)) {
    tier = 'protect';
    reason = task.removesBottleneck ? 'Attacks your current bottleneck' : 'High value on an important goal';
  } else if (sustaining || (task.recurrence !== 'none' && align >= 0.45)) {
    tier = 'maintain';
    reason = sustaining ? 'Sustains health, recovery or relationships' : 'Recurring upkeep for an active goal';
  } else if (urgency >= 0.55 && impact <= 0.5 && compounding <= 0.5) {
    tier = 'obligation';
    reason = 'Time-sensitive but low upside';
  } else if (align < 0.35 && impact <= 0.25) {
    tier = 'reduce';
    reason = 'Low alignment and low impact';
  } else if (result.score >= 55) {
    tier = 'protect';
    reason = 'Strong overall leverage';
  } else {
    tier = 'optional';
    reason = 'Useful, but not the best use of today';
  }

  return { tier, reason, busywork, busyworkReason, overridden: false };
}
