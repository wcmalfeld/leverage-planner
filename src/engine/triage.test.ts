import { describe, expect, it } from 'vitest';
import { generatePlan, shutdownSlot, type ScheduleInput } from './scheduler';
import { triage } from './triage';
import { rankTasks } from './scoring';
import { classifyTask } from './classify';
import { H, commitment, goal, settings, task } from './testkit';
import type { DayPlan, Task } from '../domain/types';

const DATE = '2026-11-02'; // Monday
const goals = [goal({ id: 'career', importance: 5, order: 0 }), goal({ id: 'side', importance: 2, order: 1 })];
const plan = (p: Partial<ScheduleInput>) => generatePlan({ date: DATE, tasks: [], goals, commitments: [], settings: settings(), ...p });
const placed = (p: DayPlan) => new Set(p.blocks.filter((b) => b.type === 'task').map((b) => b.taskId));

const strong = task({ id: 'strong', goalIds: ['career'], impact: 5, compounding: 4, expectedResult: 'x', durationMin: 60 });
const weak = task({ id: 'weak', goalIds: ['side'], impact: 3, durationMin: 30, expectedResult: 'x' });

function scores(tasks: Task[]) {
  const ranked = rankTasks(tasks, settings().weights, { today: DATE, goals, tasksById: new Map(tasks.map((t) => [t.id, t])) });
  return { ranked, classes: new Map(ranked.map((r) => [r.task.id, classifyTask(r.task, r.result, goals)])) };
}

describe('leverage bar', () => {
  it('leaves tasks below the bar out of the plan and says why', () => {
    const { ranked } = scores([strong, weak]);
    const bar = Math.round((ranked[0].result.score + ranked[1].result.score) / 2);
    const p = plan({ tasks: [strong, weak], settings: settings({ leverageBar: bar }) });
    expect(placed(p)).toEqual(new Set(['strong']));
    const u = p.unscheduled.find((x) => x.taskId === 'weak')!;
    expect(u.belowBar).toBe(true);
    expect(u.reason).toMatch(/leverage bar/);
  });

  it('is off at 0', () => {
    expect(placed(plan({ tasks: [strong, weak] }))).toEqual(new Set(['strong', 'weak']));
  });

  it('lets kept, committed and nearly-due tasks through', () => {
    const s = settings({ leverageBar: 99 });
    expect(placed(plan({ tasks: [{ ...weak, keepBelowBar: true }], settings: s })).has('weak')).toBe(true);
    expect(placed(plan({ tasks: [{ ...weak, plannedFor: DATE }], settings: s })).has('weak')).toBe(true);
    expect(placed(plan({ tasks: [{ ...weak, deadline: '2026-11-03' }], settings: s })).has('weak')).toBe(true);
    // A deadline further out doesn't buy an exemption: urgency alone isn't value.
    expect(placed(plan({ tasks: [{ ...weak, deadline: '2026-11-06' }], settings: s })).has('weak')).toBe(false);
  });

  it('“Keep” also overrides the low-leverage (Reduce) tier', () => {
    const noise = task({ id: 'noise', impact: 1, durationMin: 30 });
    expect(placed(plan({ tasks: [noise] })).size).toBe(0);
    expect(placed(plan({ tasks: [{ ...noise, keepBelowBar: true }] })).has('noise')).toBe(true);
  });

  it('skips snoozed tasks until the snooze ends', () => {
    expect(placed(plan({ tasks: [{ ...strong, snoozedUntil: '2026-11-09' }] })).size).toBe(0);
    expect(placed(plan({ tasks: [{ ...strong, snoozedUntil: DATE }] })).has('strong')).toBe(true);
  });

  it('builds a triage queue, lowest score first, with exemptions listed separately', () => {
    const noise = task({ id: 'noise', goalIds: ['side'], impact: 1, durationMin: 30, expectedResult: 'x' });
    const due = { ...weak, id: 'due', deadline: DATE };
    const snoozed = { ...weak, id: 'zz', snoozedUntil: '2026-11-09' };
    const { ranked, classes } = scores([strong, weak, noise, due, snoozed]);
    const t = triage(ranked, classes, { leverageBar: 99 }, DATE);
    expect(t.queue.map((i) => i.ranked.task.id)).toEqual(expect.arrayContaining(['weak', 'noise']));
    expect(t.queue[0].ranked.result.score).toBeLessThanOrEqual(t.queue[1].ranked.result.score);
    expect(t.exempt.find((i) => i.ranked.task.id === 'due')?.exempt).toMatch(/Due/);
    expect(t.snoozed.map((x) => x.id)).toEqual(['zz']);
  });
});

describe('committing to a day', () => {
  it('prioritises a task you planned for today and flags it if it misses', () => {
    const filler = [1, 2, 3].map((i) => task({ id: `f${i}`, goalIds: ['career'], impact: 5, durationMin: 60, expectedResult: 'x' }));
    const p = plan({ tasks: [...filler, { ...weak, plannedFor: DATE }], settings: settings({ wake: H(9), sleep: H(12), focusWindows: [], energy: [] }) });
    expect(placed(p).has('weak')).toBe(true);
  });

  it('places committed tasks ahead of higher scores when the work cap is tight', () => {
    const filler = [1, 2, 3].map((i) => task({ id: `f${i}`, goalIds: ['career'], impact: 5, compounding: 5, durationMin: 60, expectedResult: 'x' }));
    const p = plan({ tasks: [...filler, { ...weak, plannedFor: DATE }], settings: settings({ maxWorkMin: 90 }) });
    expect(placed(p).has('weak')).toBe(true);
  });
});

describe('shutdown block', () => {
  const s = settings({ shutdown: { enabled: true, at: H(17, 30), durationMin: 15 } });

  it('reserves a short block at the chosen time and keeps tasks off it', () => {
    const tasks = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => task({ id: `t${i}`, goalIds: ['career'], impact: 4, durationMin: 60, expectedResult: 'x' }));
    const p = plan({ tasks, settings: s });
    const sd = p.blocks.filter((b) => b.type === 'shutdown');
    expect(sd).toHaveLength(1);
    expect([sd[0].start, sd[0].end]).toEqual([H(17, 30), H(17, 45)]);
    expect(p.blocks.filter((b) => b.type === 'task').every((b) => b.end <= sd[0].start || b.start >= sd[0].end)).toBe(true);
  });

  it('moves after a commitment that covers the chosen time', () => {
    const p = plan({ settings: s, commitments: [commitment({ id: 'dinner', start: H(17), end: H(18, 30) })] });
    const sd = p.blocks.find((b) => b.type === 'shutdown')!;
    expect(sd.start).toBe(H(18, 30));
  });

  it('keeps a shutdown block you moved', () => {
    const first = plan({ settings: s });
    const moved = { ...first, blocks: first.blocks.map((b) => (b.type === 'shutdown' ? { ...b, start: H(16), end: H(16, 15), locked: true } : b)) };
    const again = plan({ settings: s, previous: moved });
    expect(again.blocks.filter((b) => b.type === 'shutdown').map((b) => b.start)).toEqual([H(16)]);
  });

  it('is off when disabled', () => {
    expect(plan({}).blocks.some((b) => b.type === 'shutdown')).toBe(false);
  });

  it('shutdownSlot falls back to the latest slot before the chosen time', () => {
    expect(shutdownSlot([{ start: H(9), end: H(12) }], H(17, 30), 15)).toEqual({ start: H(11, 45), end: H(12) });
    expect(shutdownSlot([{ start: H(9), end: H(9, 10) }], H(17, 30), 15)).toBeNull();
  });
});
