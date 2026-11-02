import { describe, expect, it } from 'vitest';
import { generatePlan, occursOn, splitInto, type ScheduleInput } from './scheduler';
import { computeAvailability, subtract } from './availability';
import { H, commitment, goal, settings, task } from './testkit';
import type { Block, DayPlan } from '../domain/types';

const DATE = '2026-11-02'; // Monday
const goals = [goal({ id: 'career', importance: 5, order: 0 }), goal({ id: 'biz', importance: 4, order: 1 }), goal({ id: 'side', importance: 2, order: 2 })];

const plan = (p: Partial<ScheduleInput>) =>
  generatePlan({ date: DATE, tasks: [], goals, commitments: [], settings: settings(), ...p });
const taskBlocks = (p: DayPlan) => p.blocks.filter((b) => b.type === 'task');
const noOverlap = (blocks: Block[]) => {
  const s = [...blocks].sort((a, b) => a.start - b.start);
  for (let i = 1; i < s.length; i++) if (s[i].start < s[i - 1].end) return false;
  return true;
};

describe('availability', () => {
  it('subtracts commitments and travel from the waking day', () => {
    const a = computeAvailability(DATE, settings(), [
      commitment({ id: 'work', start: H(9), end: H(12), travelBeforeMin: 30, travelAfterMin: 30 }),
    ]);
    expect(a.windows.map((w) => [w.start, w.end])).toEqual([
      [H(7), H(8, 30)],
      [H(12, 30), H(22)],
    ]);
  });

  it('only applies commitments on their days or date', () => {
    const tueOnly = commitment({ id: 'x', start: H(9), end: H(10), days: [2] });
    const oneOff = commitment({ id: 'y', start: H(13), end: H(14), days: [], date: DATE });
    const a = computeAvailability(DATE, settings(), [tueOnly, oneOff]);
    expect(a.busy.map((b) => b.commitment.id)).toEqual(['y']);
  });

  it('detects overlapping commitments', () => {
    const a = computeAvailability(DATE, settings(), [
      commitment({ id: 'a', start: H(9), end: H(11) }),
      commitment({ id: 'b', start: H(10), end: H(12) }),
    ]);
    expect(a.overlaps).toHaveLength(1);
  });

  it('flags travel time that runs into another commitment, except between events at the same place', () => {
    const breakfast = commitment({ id: 'breakfast', start: H(6, 30), end: H(7, 15) });
    const dentist = commitment({ id: 'dentist', start: H(7, 15), end: H(8), travelBeforeMin: 15, location: 'clinic' });
    const [o] = computeAvailability(DATE, settings(), [breakfast, dentist]).overlaps;
    expect(o).toMatchObject({ viaTravel: true, a: { id: 'dentist' }, b: { id: 'breakfast' } });

    const checkup = commitment({ id: 'checkup', start: H(8), end: H(8, 30), travelBeforeMin: 15, location: 'clinic' });
    expect(computeAvailability(DATE, settings(), [dentist, checkup]).overlaps).toHaveLength(0);
  });

  it('tags windows sandwiched between commitments at the same place', () => {
    const a = computeAvailability(DATE, settings(), [
      commitment({ id: 'am', start: H(8), end: H(12), location: 'campus' }),
      commitment({ id: 'pm', start: H(13), end: H(17), location: 'campus' }),
    ]);
    expect(a.windows.find((w) => w.start === H(12))?.location).toBe('campus');
  });

  it('subtract handles splits and edges', () => {
    expect(subtract([{ start: 0, end: 100 }], { start: 40, end: 60 })).toEqual([
      { start: 0, end: 40 },
      { start: 60, end: 100 },
    ]);
    expect(subtract([{ start: 0, end: 100 }], { start: 0, end: 100 })).toEqual([]);
  });
});

describe('scheduler constraints', () => {
  it('never overlaps fixed commitments and stays inside waking hours', () => {
    const p = plan({
      commitments: [commitment({ id: 'work', start: H(9), end: H(17) })],
      tasks: [
        task({ id: 'a', goalIds: ['career'], durationMin: 60, impact: 5 }),
        task({ id: 'b', goalIds: ['biz'], durationMin: 90, impact: 4 }),
        task({ id: 'c', goalIds: ['side'], durationMin: 45 }),
      ],
    });
    expect(noOverlap(p.blocks)).toBe(true);
    for (const b of p.blocks) {
      expect(b.start).toBeGreaterThanOrEqual(H(7));
      expect(b.end).toBeLessThanOrEqual(H(22));
    }
    for (const b of taskBlocks(p)) expect(b.start >= H(17) || b.end <= H(9)).toBe(true);
  });

  it('places high-energy work in peak/focus time and low-energy work later', () => {
    const p = plan({
      tasks: [
        task({ id: 'deep', goalIds: ['career'], durationMin: 90, impact: 5, energy: 'high' }),
        task({ id: 'admin', goalIds: ['side'], durationMin: 30, impact: 3, energy: 'low' }),
      ],
    });
    const deep = taskBlocks(p).find((b) => b.taskId === 'deep')!;
    const admin = taskBlocks(p).find((b) => b.taskId === 'admin')!;
    expect(deep.start).toBeGreaterThanOrEqual(H(8));
    expect(deep.end).toBeLessThanOrEqual(H(11));
    expect(admin.start).toBeGreaterThanOrEqual(H(16));
  });

  it('respects dependencies: prerequisites are pulled in and placed first', () => {
    const p = plan({
      tasks: [
        task({ id: 'outline', goalIds: ['side'], durationMin: 30, impact: 2 }),
        task({ id: 'write', goalIds: ['career'], durationMin: 60, impact: 5, dependsOn: ['outline'] }),
      ],
    });
    const outline = taskBlocks(p).find((b) => b.taskId === 'outline')!;
    const write = taskBlocks(p).find((b) => b.taskId === 'write')!;
    expect(outline).toBeDefined();
    expect(write.start).toBeGreaterThanOrEqual(outline.end);
  });

  it('reports a task whose prerequisite cannot happen today', () => {
    const p = plan({
      tasks: [
        task({ id: 'dep', status: 'deferred' }),
        task({ id: 't', goalIds: ['career'], impact: 5, dependsOn: ['dep'] }),
      ],
    });
    expect(taskBlocks(p).some((b) => b.taskId === 't')).toBe(false);
    expect(p.unscheduled.find((u) => u.taskId === 't')?.reason).toMatch(/Waiting on/);
  });

  it('adds buffers after tasks and a real break after long focus runs', () => {
    const p = plan({
      settings: settings({ focusWindows: [], energy: [], breakAfterMin: 90 }),
      tasks: [
        task({ id: 'a', goalIds: ['career'], durationMin: 60, impact: 5 }),
        task({ id: 'b', goalIds: ['career'], durationMin: 60, impact: 5 }),
      ],
    });
    expect(p.blocks.some((b) => b.type === 'buffer')).toBe(true);
    expect(p.blocks.some((b) => b.type === 'break' && b.end - b.start >= 15)).toBe(true);
    expect(noOverlap(p.blocks)).toBe(true);
  });

  it('splits tasks longer than the max block length', () => {
    const p = plan({ tasks: [task({ id: 'big', goalIds: ['career'], durationMin: 240, impact: 5 })] });
    const chunks = taskBlocks(p).filter((b) => b.taskId === 'big');
    expect(chunks.length).toBe(2);
    expect(chunks.reduce((s, b) => s + b.end - b.start, 0)).toBe(240);
    expect(chunks.every((c) => c.chunk?.of === 2)).toBe(true);
  });

  it('does not force tasks in just to fill the day — keeps requested open time', () => {
    const p = plan({
      settings: settings({ wake: H(9), sleep: H(13), unscheduledMin: 120, focusWindows: [], energy: [] }),
      tasks: [
        task({ id: 'a', goalIds: ['career'], durationMin: 60, impact: 5 }),
        task({ id: 'b', goalIds: ['biz'], durationMin: 60, impact: 4 }),
        task({ id: 'c', goalIds: ['side'], durationMin: 60, impact: 3 }),
      ],
    });
    expect(p.stats.slackMin).toBeGreaterThanOrEqual(120);
    expect(p.unscheduled.some((u) => /open time/.test(u.reason))).toBe(true);
  });

  it('reports important tasks that do not fit, with concrete suggestions', () => {
    const p = plan({
      settings: settings({ wake: H(9), sleep: H(10, 30) }),
      tasks: [task({ id: 'huge', goalIds: ['career'], durationMin: 120, impact: 5, compounding: 5, expectedResult: 'x', splittable: false })],
    });
    const u = p.unscheduled.find((x) => x.taskId === 'huge')!;
    expect(u.important).toBe(true);
    expect(u.reason).toMatch(/largest open window/);
    const c = p.conflicts.find((c) => c.message.includes('huge'))!;
    expect(c.suggestions.length).toBeGreaterThan(0);
    expect(c.suggestions.join(' ')).toMatch(/Shorten|tomorrow/);
  });

  it('flags overlapping commitments as critical', () => {
    const p = plan({
      commitments: [commitment({ id: 'a', start: H(9), end: H(11) }), commitment({ id: 'b', start: H(10), end: H(12) })],
    });
    expect(p.conflicts.some((c) => c.severity === 'critical')).toBe(true);
  });

  it('warns rather than borrowing from sleep', () => {
    const p = plan({ settings: settings({ wake: H(5), sleep: H(23, 30) }) });
    expect(p.conflicts.some((c) => /sleep/.test(c.message))).toBe(true);
  });

  it('balances goals instead of stacking one goal all day', () => {
    const tasks = [
      ...[1, 2, 3, 4].map((i) => task({ id: `c${i}`, goalIds: ['career'], durationMin: 45, impact: 4, expectedResult: 'x' })),
      task({ id: 'b1', goalIds: ['biz'], durationMin: 45, impact: 4, expectedResult: 'x' }),
    ];
    const p = plan({ settings: settings({ wake: H(9), sleep: H(13), focusWindows: [], energy: [] }), tasks });
    // Only ~4 fit; the business task should make the cut despite a slightly lower score.
    expect(taskBlocks(p).some((b) => b.taskId === 'b1')).toBe(true);
  });

  it('keeps locked (user-edited) blocks exactly in place on regeneration', () => {
    const tasks = [task({ id: 'a', goalIds: ['career'], durationMin: 60, impact: 5 }), task({ id: 'b', goalIds: ['biz'], durationMin: 60 })];
    const first = plan({ tasks });
    const a = taskBlocks(first).find((b) => b.taskId === 'a')!;
    const moved: Block = { ...a, start: H(19), end: H(20), locked: true };
    const prev: DayPlan = { ...first, blocks: first.blocks.map((b) => (b.id === a.id ? moved : b)) };
    const second = plan({ tasks, previous: prev });
    const a2 = taskBlocks(second).filter((b) => b.taskId === 'a');
    expect(a2).toHaveLength(1);
    expect([a2[0].start, a2[0].end]).toEqual([H(19), H(20)]);
    expect(noOverlap(second.blocks)).toBe(true);
  });

  it('re-places a locked block when a new fixed event lands on top of it', () => {
    const tasks = [task({ id: 'a', goalIds: ['career'], durationMin: 60, impact: 5 })];
    const first = plan({ tasks });
    const a = taskBlocks(first).find((b) => b.taskId === 'a')!;
    const prev: DayPlan = { ...first, blocks: first.blocks.map((b) => (b.id === a.id ? { ...a, locked: true, status: 'accepted' as const } : b)) };
    const dentist = commitment({ id: 'dentist', title: 'Dentist', days: [], date: DATE, start: a.start, end: a.end, kind: 'appointment' });
    const second = plan({ tasks, previous: prev, commitments: [dentist] });
    const a2 = taskBlocks(second).filter((b) => b.taskId === 'a');
    expect(a2).toHaveLength(1);
    expect(a2[0].start >= a.end || a2[0].end <= a.start).toBe(true);
    expect(noOverlap(second.blocks)).toBe(true);
    expect(second.conflicts.some((c) => c.message.includes('clashed with “Dentist”'))).toBe(true);
  });

  it('never schedules a rejected task, and keeps the task itself', () => {
    const tasks = [task({ id: 'a', goalIds: ['career'], durationMin: 60, impact: 5 })];
    const first = plan({ tasks });
    const second = plan({ tasks, previous: { ...first, rejectedTaskIds: ['a'] } });
    expect(taskBlocks(second)).toHaveLength(0);
    expect(tasks).toHaveLength(1);
  });

  it('respects location: a home-only task is not placed in an away window', () => {
    const p = plan({
      settings: settings({ wake: H(8), sleep: H(17), focusWindows: [], energy: [] }),
      commitments: [
        commitment({ id: 'am', start: H(8), end: H(12), location: 'campus' }),
        commitment({ id: 'pm', start: H(13), end: H(17), location: 'campus' }),
      ],
      tasks: [task({ id: 'garage', durationMin: 30, goalIds: ['career'], location: 'home' })],
    });
    expect(taskBlocks(p)).toHaveLength(0);
    expect(p.unscheduled[0].reason).toMatch(/home/);
  });

  it('skips completed/deferred tasks, low-leverage tasks, and off-day recurrences', () => {
    const p = plan({
      tasks: [
        task({ id: 'done', status: 'completed' }),
        task({ id: 'later', status: 'deferred' }),
        task({ id: 'noise', impact: 1, durationMin: 60 }),
        task({ id: 'sat', goalIds: ['career'], recurrence: 'weekly', recurrenceDay: 6 }),
      ],
    });
    expect(taskBlocks(p)).toHaveLength(0);
    expect(p.unscheduled.find((u) => u.taskId === 'noise')?.important).toBe(false);
  });

  it('respects the daily cap on focused work (recovery is protected)', () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task({ id: `t${i}`, goalIds: ['career'], durationMin: 60, impact: 5, expectedResult: 'x' }));
    const p = plan({ settings: settings({ maxWorkMin: 150 }), tasks });
    expect(p.stats.plannedTaskMin).toBeLessThanOrEqual(150);
    expect(p.unscheduled.some((u) => /cap on focused work/.test(u.reason))).toBe(true);
  });

  it('does not schedule unclarified inbox items', () => {
    const p = plan({ tasks: [task({ id: 'vague', goalIds: ['career'], status: 'inbox', impact: 5 })] });
    expect(taskBlocks(p)).toHaveLength(0);
    expect(p.unscheduled[0].reason).toMatch(/clarify/);
  });

  it('is deterministic', () => {
    const tasks = [task({ id: 'a', goalIds: ['career'], durationMin: 60 }), task({ id: 'b', goalIds: ['biz'], durationMin: 45 })];
    const strip = (p: DayPlan) => ({ ...p, generatedAt: '' });
    expect(strip(plan({ tasks }))).toEqual(strip(plan({ tasks })));
  });
});

describe('helpers', () => {
  it('recurrence', () => {
    expect(occursOn(task({ id: 'a', recurrence: 'weekdays' }), DATE)).toBe(true);
    expect(occursOn(task({ id: 'a', recurrence: 'weekdays' }), '2026-11-01')).toBe(false); // Sunday
    expect(occursOn(task({ id: 'a', recurrence: 'daily', lastDoneOn: DATE }), DATE)).toBe(false);
  });
  it('splitInto preserves total', () => {
    expect(splitInto(250, 2).reduce((a, b) => a + b, 0)).toBe(250);
  });
});
