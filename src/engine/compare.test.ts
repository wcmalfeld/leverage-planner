import { describe, expect, it } from 'vitest';
import { compareDay, currentBlocksFor } from './compare';
import { generatePlan } from './scheduler';
import { rankTasks, DEFAULT_WEIGHTS } from './scoring';
import { topThree, stopOrPostpone } from './insights';
import { estimateFactors, planVsActual } from './review';
import { H, goal, settings, task } from './testkit';
import type { CurrentBlock } from '../domain/types';

const DATE = '2026-11-02';
const goals = [goal({ id: 'career', importance: 5, order: 0 }), goal({ id: 'health', importance: 4, order: 1, sustaining: true })];
const tasks = [
  task({ id: 'apply', title: 'Apply to role', goalIds: ['career'], durationMin: 60, impact: 5, expectedResult: 'Submitted' }),
  task({ id: 'net', title: 'Message engineers', goalIds: ['career'], durationMin: 30, impact: 4 }),
  task({ id: 'fold', title: 'Reorganise folders', durationMin: 60, impact: 2 }),
];
const s = settings({ focusWindows: [], energy: [] });
const ranked = rankTasks(tasks, DEFAULT_WEIGHTS, { today: DATE, goals, tasksById: new Map(tasks.map((t) => [t.id, t])) });
const plan = generatePlan({ date: DATE, tasks, goals, commitments: [], settings: s });

const current: CurrentBlock[] = [
  { id: 'c1', title: 'Scroll news', days: [1], start: H(7), end: H(8, 30), value: 'distraction' },
  { id: 'c2', title: 'Gym', days: [1], start: H(17), end: H(18), goalId: 'health' },
  { id: 'c3', title: 'Weekend thing', days: [6], start: H(9), end: H(10) },
];

describe('comparison', () => {
  const cmp = compareDay({ date: DATE, plan, currentPlan: current, commitments: [], tasks, goals, ranked, settings: s });

  it('selects only the current blocks for that weekday', () => {
    expect(cmp.current.map((c) => c.id)).toEqual(['c1', 'c2']);
  });

  it('dated entries override overlapping typical-week entries', () => {
    const withDated = [...current, { id: 'd', title: 'Dentist', days: [], date: DATE, start: H(8), end: H(9) }];
    expect(currentBlocksFor(withDated, DATE).map((c) => c.id)).toEqual(['d', 'c2']);
  });

  it('finds high-leverage work missing from the current plan', () => {
    expect(cmp.missing.map((m) => m.taskId)).toContain('apply');
    expect(cmp.missing[0].score).toBeGreaterThanOrEqual(cmp.missing.at(-1)!.score);
  });

  it('identifies low-value current time', () => {
    expect(cmp.lowValue.map((l) => l.block.id)).toEqual(['c1']);
  });

  it('allocates time by goal for both plans', () => {
    const career = cmp.allocation.find((r) => r.key === 'career')!;
    expect(career.recommended).toBeGreaterThan(career.current);
    const health = cmp.allocation.find((r) => r.key === 'health')!;
    expect(health.current).toBe(60);
  });

  it('ranks concrete changes, including protecting health', () => {
    expect(cmp.changes.length).toBeGreaterThan(0);
    for (let i = 1; i < cmp.changes.length; i++) expect(cmp.changes[i - 1].value).toBeGreaterThanOrEqual(cmp.changes[i].value);
    expect(cmp.changes.some((c) => c.kind === 'protect' && c.title.includes('Gym'))).toBe(true);
    expect(cmp.changes.some((c) => (c.kind === 'replace' || c.kind === 'remove') && c.title.includes('Scroll'))).toBe(true);
  });

  it('daily brief: top three with success criteria, and things to stop', () => {
    const top = topThree(plan, ranked, goals);
    expect(top[0].task.id).toBe('apply');
    expect(top[0].success).toBe('Submitted');
    expect(top.every((t) => t.why.length > 0)).toBe(true);
    const stop = stopOrPostpone(plan, ranked, goals, cmp);
    expect(stop.some((x) => x.title.includes('Scroll news'))).toBe(true);
    expect(stop.some((x) => x.title.includes('Reorganise folders'))).toBe(true);
  });
});

describe('review feedback', () => {
  it('learns duration estimates per goal after three samples', () => {
    const done = [1, 2, 3].map((i) => task({ id: `t${i}`, goalIds: ['career'], status: 'completed', durationMin: 60, actualMin: 90 }));
    expect(estimateFactors(done).career).toBe(1.5);
    expect(estimateFactors(done.slice(0, 2)).career).toBeUndefined();
  });

  it('compares planned vs actual', () => {
    const t = { ...tasks[0], status: 'completed' as const, completedAt: DATE };
    const pva = planVsActual(plan, [t, ...tasks.slice(1)], [{ id: 'x', date: DATE, title: 'Apply', minutes: 75, taskId: 'apply' }], DATE);
    expect(pva.completedTasks).toBe(1);
    expect(pva.actualMin).toBe(75);
  });
});
