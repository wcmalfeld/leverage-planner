import { describe, expect, it } from 'vitest';
import { applyFreshStart, type FreshStartPlan } from './actions';
import { commitment, goal, settings, task } from '../engine/testkit';
import type { AppData } from '../domain/types';

const DATE = '2026-11-09';

function app(): AppData {
  return {
    version: 1,
    onboarded: true,
    goals: [goal({ id: 'a', order: 0 }), goal({ id: 'b', order: 1 }), goal({ id: 'old', order: 2, status: 'achieved' })],
    bottleneck: { statement: 'No income', goalIds: ['a'], updatedAt: DATE, history: [] },
    tasks: [
      task({ id: 'open', goalIds: ['a'], plannedFor: DATE }),
      task({ id: 'dep', goalIds: ['b'], dependsOn: ['open'] }),
      task({ id: 'gym', goalIds: ['b'], recurrence: 'daily' }),
      task({ id: 'done', goalIds: ['a'], status: 'completed', completedAt: '2026-11-08' }),
      task({ id: 'parked', status: 'deferred' }),
    ],
    commitments: [commitment({ id: 'ride', start: 420, end: 480, goalId: 'b' })],
    currentPlan: [],
    actuals: [{ id: 'x', date: '2026-11-08', title: 'done', minutes: 30, taskId: 'done' }],
    plans: {},
    dailyReviews: {},
    weeklyReviews: {},
    settings: settings(),
  };
}

let n = 0;
const ids = (prefix: string) => `${prefix}${++n}`;
const run = (p: Partial<FreshStartPlan>) => {
  const d = app();
  const map = applyFreshStart(d, { date: DATE, oldTasks: 'park', tasks: [], ...p }, ids);
  return { d, map, byId: (id: string) => d.tasks.find((t) => t.id === id) };
};

describe('fresh start: new tasks, same goals', () => {
  it('parks open one-off tasks, keeps routines and history, and commits new tasks to today', () => {
    const { d, byId } = run({ tasks: [{ title: ' Call Dana ', goalKey: 'a', durationMin: 30 }, { title: '', goalKey: 'a' }] });
    expect(byId('open')).toMatchObject({ status: 'deferred', plannedFor: undefined });
    expect(byId('dep')!.status).toBe('deferred');
    expect(byId('gym')!.status).toBe('ready');
    expect(byId('done')!.status).toBe('completed');
    expect(d.actuals).toHaveLength(1);
    expect(d.tasks[0]).toMatchObject({ title: 'Call Dana', goalIds: ['a'], status: 'ready', plannedFor: DATE, durationMin: 30 });
    expect(d.tasks.filter((t) => t.createdAt === DATE)).toHaveLength(1);
    expect(d.goals.map((g) => g.status)).toEqual(['active', 'active', 'achieved']);
    expect(d.bottleneck.statement).toBe('No income');
  });

  it('can delete old open tasks instead, cleaning up dependencies', () => {
    const { byId } = run({ oldTasks: 'delete' });
    expect(byId('open')).toBeUndefined();
    expect(byId('gym')!.dependsOn).toEqual([]);
    expect(byId('done')).toBeDefined();
    expect(byId('parked')).toBeDefined();
  });

  it('can leave old tasks alone', () => {
    expect(run({ oldTasks: 'keep' }).byId('open')!.status).toBe('ready');
  });
});

describe('fresh start: new goals', () => {
  const added = [{ key: 'new1', name: 'Launch the newsletter', importance: 5 as const }, { key: 'blank', name: '  ', importance: 3 as const }];

  it('archives goals you don’t keep, adds new ones, and links tasks and the bottleneck to them', () => {
    const { d, map } = run({
      goals: { keep: ['b'], others: 'archive', added, bottleneck: { statement: 'No audience yet', goalKeys: ['new1'] } },
      tasks: [{ title: 'Write issue #1', goalKey: 'new1' }],
    });
    expect(d.goals.find((g) => g.id === 'a')!.status).toBe('dropped');
    expect(d.goals.find((g) => g.id === 'b')!.status).toBe('active');
    expect(d.goals.find((g) => g.id === 'old')!.status).toBe('achieved');
    const fresh = d.goals.find((g) => g.id === map.new1)!;
    expect(fresh).toMatchObject({ name: 'Launch the newsletter', importance: 5, status: 'active', order: 3 });
    expect(d.goals).toHaveLength(4); // the blank one is skipped
    expect(d.tasks[0].goalIds).toEqual([map.new1]);
    expect(d.bottleneck).toMatchObject({ statement: 'No audience yet', goalIds: [map.new1] });
    expect(d.bottleneck.history.at(-1)!.statement).toBe('No audience yet');
  });

  it('can delete old goals, unlinking everything that pointed at them, and clears a stale bottleneck', () => {
    const { d } = run({ oldTasks: 'keep', goals: { keep: [], others: 'delete', added: [] }, tasks: [{ title: 'Orphan', goalKey: 'a' }] });
    expect(d.goals.map((g) => g.id)).toEqual(['old']);
    expect(d.tasks.find((t) => t.id === 'open')!.goalIds).toEqual([]);
    expect(d.commitments[0].goalId).toBeUndefined();
    expect(d.bottleneck).toMatchObject({ statement: '', goalIds: [] });
    expect(d.tasks.some((t) => t.title === 'Orphan')).toBe(false); // its goal is gone
  });
});
