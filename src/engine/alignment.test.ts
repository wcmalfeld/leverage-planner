import { describe, expect, it } from 'vitest';
import { driftAlerts, goalTargets, scorecard, stalledGoals } from './alignment';
import { dueNudges, nudgeText } from './nudge';
import { H, commitment, goal, settings, task } from './testkit';
import type { AppData, Block } from '../domain/types';

const TODAY = '2026-11-04'; // Wednesday; week starts Mon 2026-11-02

function app(p: Partial<AppData> = {}): AppData {
  return {
    version: 1,
    onboarded: true,
    goals: [goal({ id: 'a', importance: 5, order: 0 }), goal({ id: 'b', importance: 3, order: 1 })],
    bottleneck: { statement: '', goalIds: [], updatedAt: TODAY, history: [] },
    tasks: [],
    commitments: [],
    currentPlan: [],
    actuals: [],
    plans: {},
    dailyReviews: {},
    weeklyReviews: {},
    settings: settings(),
    ...p,
  };
}

const block = (p: Partial<Block> & { id: string; start: number; end: number }): Block => ({
  date: TODAY, title: p.id, type: 'task', goalIds: [], status: 'proposed', fixed: false, ...p,
});

describe('goal targets', () => {
  it('implies shares from importance when none are set', () => {
    const t = goalTargets(app().goals);
    expect(t.get('a')!.share).toBeGreaterThan(t.get('b')!.share);
    expect(t.get('a')!.share + t.get('b')!.share).toBeCloseTo(1);
    expect(t.get('a')!.explicit).toBe(false);
  });

  it('keeps targets you set and splits the rest', () => {
    const goals = [goal({ id: 'a', targetShare: 70 }), goal({ id: 'b' }), goal({ id: 'c' })];
    const t = goalTargets(goals);
    expect(t.get('a')).toEqual({ share: 0.7, explicit: true });
    expect(t.get('b')!.share + t.get('c')!.share).toBeCloseTo(0.3);
  });

  it('scales targets that add up to more than 100%', () => {
    const t = goalTargets([goal({ id: 'a', targetShare: 80 }), goal({ id: 'b', targetShare: 80 })]);
    expect(t.get('a')!.share).toBeCloseTo(0.5);
  });

  it('ignores paused goals', () => {
    expect(goalTargets([goal({ id: 'a' }), goal({ id: 'b', status: 'paused' })]).has('b')).toBe(false);
  });
});

describe('scorecard', () => {
  it('splits logged time into goal time, unlinked time and distraction', () => {
    const data = app({
      tasks: [task({ id: 't1', goalIds: ['a'] })],
      actuals: [
        { id: '1', date: TODAY, title: 'x', minutes: 90, taskId: 't1' },
        { id: '2', date: TODAY, title: 'y', minutes: 30, goalId: 'b' },
        { id: '3', date: TODAY, title: 'email', minutes: 40 },
        { id: '4', date: TODAY, title: 'phone', minutes: 40, distraction: true },
        { id: '5', date: '2026-10-20', title: 'old', minutes: 500, goalId: 'a' },
      ],
      plans: { [TODAY]: { date: TODAY, blocks: [block({ id: 'p', start: H(9), end: H(11), goalIds: ['a'] }), block({ id: 'r', start: H(12), end: H(13), goalIds: ['b'], status: 'rejected' })], unscheduled: [], conflicts: [], rejectedTaskIds: [], generatedAt: '', stats: { freeMin: 0, plannedTaskMin: 0, slackMin: 0 } } },
    });
    const s = scorecard(data, '2026-11-02', TODAY);
    expect(s.goalMin).toBe(120);
    expect(s.unlinkedMin).toBe(40);
    expect(s.distractionMin).toBe(40);
    expect(s.alignedPct).toBeCloseTo(0.6);
    const a = s.rows.find((r) => r.goal.id === 'a')!;
    expect([a.actualMin, a.actualShare, a.plannedMin, a.plannedShare]).toEqual([90, 0.75, 120, 1]);
  });

  it('is null-aligned with nothing logged', () => {
    expect(scorecard(app(), '2026-11-02', TODAY).alignedPct).toBeNull();
  });
});

describe('drift alerts', () => {
  const week = (start: string, a: number, b: number) => [
    { id: start + 'a', date: start, title: 'a', minutes: a, goalId: 'a' },
    { id: start + 'b', date: start, title: 'b', minutes: b, goalId: 'b' },
  ];
  const goals = [goal({ id: 'a', targetShare: 60 }), goal({ id: 'b', targetShare: 40 })];

  it('flags a goal under target two full weeks running', () => {
    const d = driftAlerts(app({ goals, actuals: [...week('2026-10-19', 60, 240), ...week('2026-10-26', 30, 270)] }), TODAY);
    expect(d.map((x) => x.goal.id)).toEqual(['a']);
    expect(d[0].shares[1]).toBeCloseTo(0.1);
  });

  it('ignores a single off week', () => {
    expect(driftAlerts(app({ goals, actuals: [...week('2026-10-19', 200, 100), ...week('2026-10-26', 30, 270)] }), TODAY)).toEqual([]);
  });
});

describe('stalled goals', () => {
  const reasons = (data: AppData) => Object.fromEntries(stalledGoals(data, TODAY).map((s) => [s.goal.id, s.reason]));

  it('flags a goal with no next action', () => {
    expect(reasons(app({ tasks: [task({ id: 't', goalIds: ['a'] })] })).b).toBe('no-next-action');
  });

  it('flags no progress in 14 days, and nothing this week', () => {
    const tasks = [task({ id: 'ta', goalIds: ['a'] }), task({ id: 'tb', goalIds: ['b'] })];
    const actuals = [{ id: '1', date: '2026-10-28', title: 'x', minutes: 30, taskId: 'ta' }];
    const r = reasons(app({ tasks, actuals }));
    expect(r).toEqual({ a: 'not-scheduled', b: 'no-progress' });
    expect(stalledGoals(app({ tasks, actuals }), TODAY).find((s) => s.goal.id === 'b')!.topTaskId).toBe('tb');
  });

  it('clears once it is scheduled or worked on this week', () => {
    const tasks = [task({ id: 'ta', goalIds: ['a'] }), task({ id: 'tb', goalIds: ['b'] })];
    const actuals = [{ id: '1', date: '2026-11-02', title: 'x', minutes: 30, taskId: 'ta' }, { id: '2', date: '2026-10-28', title: 'y', minutes: 30, taskId: 'tb' }];
    const plans = { '2026-11-05': { date: '2026-11-05', blocks: [block({ id: 'p', start: H(9), end: H(10), goalIds: ['b'] })], unscheduled: [], conflicts: [], rejectedTaskIds: [], generatedAt: '', stats: { freeMin: 0, plannedTaskMin: 0, slackMin: 0 } } };
    expect(reasons(app({ tasks, actuals, plans }))).toEqual({});
  });

  it('skips goals served by a recurring commitment, and snoozed tasks are not next actions', () => {
    const data = app({
      tasks: [task({ id: 'ta', goalIds: ['a'], snoozedUntil: '2026-11-10' })],
      commitments: [commitment({ id: 'ride', start: H(7), end: H(8), days: [6], goalId: 'b' })],
    });
    expect(reasons(data)).toEqual({ a: 'no-next-action' });
  });
});

describe('start nudges', () => {
  const blocks = [block({ id: 'x', start: H(10), end: H(11) }), block({ id: 'done', start: H(10), end: H(11), status: 'done' }), block({ id: 'c', start: H(10), end: H(11), type: 'commitment' })];

  it('fires from the lead time until shortly after the start, once', () => {
    expect(dueNudges(blocks, H(9, 58), 1, new Set())).toEqual([]);
    expect(dueNudges(blocks, H(9, 59), 1, new Set()).map((b) => b.id)).toEqual(['x']);
    expect(dueNudges(blocks, H(10, 9), 1, new Set()).map((b) => b.id)).toEqual(['x']);
    expect(dueNudges(blocks, H(10, 10), 1, new Set())).toEqual([]);
    expect(dueNudges(blocks, H(10), 1, new Set(['x']))).toEqual([]);
  });

  it('leads with the resume note, then the first step, then the definition of done', () => {
    const t = task({ id: 't', firstStep: 'Open the deck', expectedResult: 'Sent' });
    expect(nudgeText(blocks[0], t, H(10)).body).toMatch(/^First step: Open the deck/);
    expect(nudgeText(blocks[0], { ...t, resumeNote: { text: 'Section 3', date: TODAY } }, H(10)).label).toBe('Pick up from');
    expect(nudgeText(blocks[0], { ...t, firstStep: undefined }, H(9, 59)).title).toBe('At 10am: x');
  });
});
