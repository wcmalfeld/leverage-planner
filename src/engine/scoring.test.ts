import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEIGHTS,
  balanceMultiplier,
  effortEfficiency,
  goalWeight,
  rankTasks,
  scoreTask,
  urgencyFromDeadline,
  whyAbove,
  type ScoringContext,
} from './scoring';
import { classifyTask } from './classify';
import { goal, task } from './testkit';
import type { Task } from '../domain/types';

const TODAY = '2026-11-02';
const goals = [
  goal({ id: 'career', importance: 5, order: 0 }),
  goal({ id: 'biz', importance: 4, order: 1 }),
  goal({ id: 'hobby', importance: 1, order: 2 }),
  goal({ id: 'health', importance: 4, order: 3, sustaining: true }),
];
const ctx = (tasks: Task[], extra: Partial<ScoringContext> = {}): ScoringContext => ({
  today: TODAY,
  goals,
  tasksById: new Map(tasks.map((t) => [t.id, t])),
  ...extra,
});
const score = (t: Task, extra: Partial<ScoringContext> = {}) => scoreTask(t, DEFAULT_WEIGHTS, ctx([t], extra));

describe('scoring factors', () => {
  it('is deterministic and bounded 0–100', () => {
    const t = task({ id: 'a', goalIds: ['career'], impact: 5, compounding: 5, confidence: 5, durationMin: 30, expectedResult: 'x', deadline: TODAY, removesBottleneck: true });
    const a = score(t);
    const b = score(t);
    expect(a.score).toBe(b.score);
    expect(a.score).toBeGreaterThan(90);
    expect(a.score).toBeLessThanOrEqual(100);
    const empty = score(task({ id: 'z' }));
    expect(empty.score).toBeGreaterThanOrEqual(0);
  });

  it('ranks goal-aligned work above unlinked work with identical ratings', () => {
    const base = { impact: 3 as const, durationMin: 60, expectedResult: 'done' };
    const aligned = score(task({ id: 'a', goalIds: ['career'], ...base }));
    const unlinked = score(task({ id: 'b', ...base }));
    expect(aligned.score).toBeGreaterThan(unlinked.score + 10);
  });

  it('weights goals by importance and rank', () => {
    expect(goalWeight(goals[0], goals)).toBeGreaterThan(goalWeight(goals[1], goals));
    expect(goalWeight(goals[1], goals)).toBeGreaterThan(goalWeight(goals[2], goals));
    expect(goalWeight({ ...goals[0], status: 'dropped' }, goals)).toBe(0);
  });

  it('does NOT simply prefer the shortest task', () => {
    const quickLow = task({ id: 'quick', goalIds: ['hobby'], impact: 2, compounding: 1, durationMin: 15, expectedResult: 'x' });
    const longHigh = task({ id: 'long', goalIds: ['career'], impact: 5, compounding: 4, durationMin: 180, expectedResult: 'x' });
    const ranked = rankTasks([quickLow, longHigh], DEFAULT_WEIGHTS, ctx([quickLow, longHigh]));
    expect(ranked[0].task.id).toBe('long');
  });

  it('does NOT simply prefer the nearest deadline', () => {
    const dueTodayTrivial = task({ id: 'trivial', goalIds: ['hobby'], impact: 1, compounding: 1, deadline: TODAY, durationMin: 30, expectedResult: 'x' });
    const strategic = task({ id: 'strategic', goalIds: ['career'], impact: 5, compounding: 5, durationMin: 60, expectedResult: 'x' });
    const ranked = rankTasks([dueTodayTrivial, strategic], DEFAULT_WEIGHTS, ctx([dueTodayTrivial, strategic]));
    expect(ranked[0].task.id).toBe('strategic');
  });

  it('urgency rises as the deadline approaches', () => {
    const v = (d?: string) => urgencyFromDeadline(d, TODAY).value;
    expect(v('2026-11-01')).toBe(1);
    expect(v(TODAY)).toBe(1);
    expect(v('2026-11-03')).toBeGreaterThan(v('2026-11-06'));
    expect(v('2026-11-06')).toBeGreaterThan(v('2026-12-30'));
    expect(v(undefined)).toBeLessThan(v('2026-11-12'));
  });

  it('effort efficiency is gentle and monotonic', () => {
    expect(effortEfficiency(30).value).toBe(1);
    expect(effortEfficiency(60).value).toBeCloseTo(0.8);
    expect(effortEfficiency(480).value).toBeGreaterThanOrEqual(0.2);
    expect(effortEfficiency(undefined).assumed).toBe(true);
  });

  it('marks missing ratings as assumptions in the explanation', () => {
    const r = score(task({ id: 'a', goalIds: ['career'] }));
    const impact = r.factors.find((f) => f.key === 'impact')!;
    expect(impact.assumed).toBe(true);
    expect(impact.note).toMatch(/assumed/);
  });

  it('boosts bottleneck-removing tasks', () => {
    const t = { goalIds: ['biz'], impact: 3 as const, durationMin: 60, expectedResult: 'x' };
    const normal = score(task({ id: 'a', ...t }));
    const bn = score(task({ id: 'b', ...t, removesBottleneck: true }));
    const viaGoal = score(task({ id: 'c', ...t }), {
      bottleneck: { statement: 's', goalIds: ['biz'], updatedAt: TODAY, history: [] },
    });
    expect(bn.score).toBeGreaterThan(viaGoal.score);
    expect(viaGoal.score).toBeGreaterThan(normal.score);
  });

  it('vague tasks score lower feasibility than clarified ones', () => {
    const vague = score(task({ id: 'v', goalIds: ['career'] }));
    const clear = score(task({ id: 'c', goalIds: ['career'], expectedResult: 'Two calls booked', durationMin: 40 }));
    const f = (r: typeof vague) => r.factors.find((x) => x.key === 'feasibility')!.value;
    expect(f(clear)).toBe(1);
    expect(f(vague)).toBeLessThan(0.6);
  });

  it('blocked tasks sink to the bottom and report blockers', () => {
    const dep = task({ id: 'dep', goalIds: ['hobby'], impact: 1 });
    const blocked = task({ id: 'blocked', goalIds: ['career'], impact: 5, dependsOn: ['dep'] });
    const ranked = rankTasks([dep, blocked], DEFAULT_WEIGHTS, ctx([dep, blocked]));
    expect(ranked.at(-1)!.task.id).toBe('blocked');
    expect(ranked.at(-1)!.result.blockedBy).toEqual(['dep']);
  });

  it('completed dependencies unblock', () => {
    const dep = task({ id: 'dep', status: 'completed' });
    const t = task({ id: 't', dependsOn: ['dep'] });
    expect(scoreTask(t, DEFAULT_WEIGHTS, ctx([dep, t])).blocked).toBe(false);
  });

  it('applies diminishing returns when one goal has dominated recent time', () => {
    const g = goals[1];
    const none = balanceMultiplier(g, ctx([], { recentGoalMinutes: { biz: 100 } }));
    expect(none.multiplier).toBe(1); // not enough history
    const dominated = balanceMultiplier(g, ctx([], { recentGoalMinutes: { biz: 900, career: 30 } }));
    expect(dominated.multiplier).toBeLessThan(1);
    expect(dominated.multiplier).toBeGreaterThanOrEqual(0.85);
    expect(dominated.note).toMatch(/nudge/);
  });

  it('respects custom weights', () => {
    const urgentLow = task({ id: 'u', goalIds: ['hobby'], impact: 2, deadline: TODAY, durationMin: 30, expectedResult: 'x' });
    const valuable = task({ id: 'v', goalIds: ['career'], impact: 5, durationMin: 30, expectedResult: 'x' });
    const urgencyOnly = { ...DEFAULT_WEIGHTS, alignment: 0, impact: 0, compounding: 0, confidence: 0, effort: 0, feasibility: 0, bottleneck: 0, urgency: 1 };
    const ranked = rankTasks([urgentLow, valuable], urgencyOnly, ctx([urgentLow, valuable]));
    expect(ranked[0].task.id).toBe('u');
  });

  it('explains why one task ranks above another', () => {
    const a = score(task({ id: 'a', goalIds: ['career'], impact: 5 }));
    const b = score(task({ id: 'b', goalIds: ['hobby'], impact: 2 }));
    const reasons = whyAbove(a, b);
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.join(' ')).toMatch(/alignment|impact/);
  });
});

describe('classification', () => {
  const cls = (t: Task) => classifyTask(t, score(t), goals);

  it('protects bottleneck work', () => {
    expect(cls(task({ id: 'a', goalIds: ['biz'], removesBottleneck: true })).tier).toBe('protect');
  });
  it('protects high-value aligned work', () => {
    expect(cls(task({ id: 'a', goalIds: ['career'], impact: 5, compounding: 4, durationMin: 60, expectedResult: 'x' })).tier).toBe('protect');
  });
  it('treats sustaining goals as maintenance', () => {
    expect(cls(task({ id: 'a', goalIds: ['health'], impact: 3, durationMin: 60, expectedResult: 'x' })).tier).toBe('maintain');
  });
  it('labels urgent low-upside tasks as obligations', () => {
    expect(cls(task({ id: 'a', goalIds: ['hobby'], impact: 2, compounding: 1, deadline: TODAY, expectedResult: 'x', durationMin: 20 })).tier).toBe('obligation');
  });
  it('flags unlinked low-impact work to reduce, and spots busywork', () => {
    const c = cls(task({ id: 'a', impact: 2, durationMin: 90 }));
    expect(c.tier).toBe('reduce');
    expect(c.busywork).toBe(true);
  });
  it('honours a user override', () => {
    const c = cls(task({ id: 'a', impact: 1, tierOverride: 'protect' }));
    expect(c.tier).toBe('protect');
    expect(c.overridden).toBe(true);
  });
});
