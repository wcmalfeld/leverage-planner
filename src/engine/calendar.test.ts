import { describe, expect, it } from 'vitest';
import { addMonths, calendarDay, monthWeeks, weekDates } from './calendar';
import { H, commitment, goal, settings, task } from './testkit';
import { emptyData } from '../store/seed';
import type { AppData, Block, DayPlan } from '../domain/types';

const MON = '2026-11-02';
const TUE = '2026-11-03';

function data(p: Partial<AppData> = {}): AppData {
  return { ...emptyData(MON), commitments: [], tasks: [], goals: [], settings: settings({ focusWindows: [], energy: [] }), ...p };
}

describe('calendarDay', () => {
  it('shows the routine for a day without a plan', () => {
    const d = data({ commitments: [commitment({ id: 'gym', days: [1], start: H(17), end: H(18) }), commitment({ id: 'lunch', start: H(12), end: H(13) })] });
    const day = calendarDay(d, MON);
    expect(day.planned).toBe(false);
    expect(day.items.map((i) => i.title)).toEqual(['lunch', 'gym']);
    expect(calendarDay(d, TUE).items.map((i) => i.title)).toEqual(['lunch']);
  });

  it('shows plan blocks once a plan exists and hides rejected ones', () => {
    const block = (id: string, start: number, status: Block['status'], type: Block['type'] = 'task'): Block =>
      ({ id, date: MON, start, end: start + 60, title: id, type, taskId: type === 'task' ? id : undefined, goalIds: [], status, fixed: false });
    const plan: DayPlan = {
      date: MON,
      blocks: [block('apply', H(9), 'accepted'), block('fold', H(15), 'rejected'), block('breather', H(10), 'proposed', 'break')],
      unscheduled: [], conflicts: [], rejectedTaskIds: [], generatedAt: '', stats: { freeMin: 0, plannedTaskMin: 60, slackMin: 0 },
    };
    // Commitments in the routine are ignored once a plan exists; the plan's own blocks win.
    const day = calendarDay(data({ plans: { [MON]: plan }, commitments: [commitment({ id: 'lunch', start: H(12), end: H(13) })] }), MON);
    expect(day.planned).toBe(true);
    expect(day.items.some((i) => i.taskId === 'apply' && i.kind === 'task')).toBe(true);
    expect(day.items.some((i) => i.taskId === 'fold')).toBe(false);
    expect(day.items.map((i) => i.title)).toEqual(['apply']);
    expect(day.plannedTaskMin).toBe(60);
  });

  it('adds deadlines, milestones and goal targets as all-day items first', () => {
    const d = data({
      commitments: [commitment({ id: 'lunch', start: H(12), end: H(13) })],
      goals: [goal({ id: 'career', targetDate: MON, milestones: [{ id: 'm1', title: 'Portfolio live', horizon: 'quarter', dueDate: MON, done: false }] })],
      tasks: [task({ id: 'cv', title: 'Send CV', deadline: MON }), task({ id: 'old', deadline: MON, status: 'deferred' })],
    });
    const kinds = calendarDay(d, MON).items.map((i) => i.kind);
    expect(kinds).toEqual(['goal-target', 'milestone', 'deadline', 'commitment']);
  });
});

describe('date grids', () => {
  it('weeks run Monday to Sunday', () => {
    expect(weekDates('2026-11-05')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']);
  });

  it('month grid covers every day of the month in whole weeks', () => {
    const weeks = monthWeeks('2026-11-15');
    const days = weeks.flat();
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(days[0]).toBe('2026-10-26');
    expect(days).toContain('2026-11-01');
    expect(days).toContain('2026-11-30');
    expect(days.at(-1)).toBe('2026-12-06');
  });

  it('addMonths clamps to the shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', -1)).toBe('2026-10-15');
  });
});
