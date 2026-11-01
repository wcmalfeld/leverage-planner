/**
 * Calendar: what each day holds, for the week and month views.
 *
 * A day with a generated plan shows that plan's commitments and task blocks.
 * A day without one shows its commitments, so the routine is visible ahead of
 * planning. Deadlines, milestones and goal target dates are layered on top.
 */
import type { AppData, Block, ISODate, Minutes } from '../domain/types';
import { addDays, parseISO, toISODate, weekStart } from '../domain/time';
import { commitmentsForDate } from './availability';
import { isOpen } from './scoring';

export type CalendarItemKind = 'commitment' | 'task' | 'deadline' | 'milestone' | 'goal-target';

export interface CalendarItem {
  id: string;
  kind: CalendarItemKind;
  title: string;
  start?: Minutes;
  end?: Minutes;
  goalIds: string[];
  taskId?: string;
  done?: boolean;
  essential?: boolean;
}

export interface CalendarDay {
  date: ISODate;
  /** True when the items come from a generated plan rather than the routine alone. */
  planned: boolean;
  items: CalendarItem[];
  plannedTaskMin: Minutes;
}

const SHOWN: Block['type'][] = ['commitment', 'task'];

export function calendarDay(data: AppData, date: ISODate): CalendarDay {
  const plan = data.plans[date];
  const timed: CalendarItem[] = plan
    ? plan.blocks
        .filter((b) => SHOWN.includes(b.type) && b.status !== 'rejected')
        .map((b) => ({
          id: b.id,
          kind: b.type === 'task' ? 'task' : 'commitment',
          title: b.title,
          start: b.start,
          end: b.end,
          goalIds: b.goalIds,
          taskId: b.taskId,
          done: b.status === 'done',
          essential: b.essential,
        }))
    : commitmentsForDate(data.commitments, date).map((c) => ({
        id: `c_${c.id}_${date}`,
        kind: 'commitment',
        title: c.title,
        start: c.start,
        end: c.end,
        goalIds: c.goalId ? [c.goalId] : [],
        essential: c.essential,
      }));
  timed.sort((a, b) => a.start! - b.start! || a.title.localeCompare(b.title));

  const allDay: CalendarItem[] = [];
  for (const g of data.goals) {
    if (g.status !== 'active') continue;
    if (g.targetDate === date) allDay.push({ id: `gt_${g.id}`, kind: 'goal-target', title: `${g.name} target date`, goalIds: [g.id] });
    for (const m of g.milestones)
      if (m.dueDate === date) allDay.push({ id: `ms_${m.id}`, kind: 'milestone', title: m.title, goalIds: [g.id], done: m.done });
  }
  for (const t of data.tasks)
    if (t.deadline === date && (isOpen(t) || t.completedAt))
      allDay.push({ id: `dl_${t.id}`, kind: 'deadline', title: t.title, goalIds: t.goalIds, taskId: t.id, done: !isOpen(t) });

  return {
    date,
    planned: !!plan,
    items: [...allDay, ...timed],
    plannedTaskMin: plan?.stats.plannedTaskMin ?? 0,
  };
}

/** Monday-to-Sunday dates of the week containing `anchor`. */
export function weekDates(anchor: ISODate): ISODate[] {
  const start = weekStart(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Whole weeks (Monday first) covering the month containing `anchor`. */
export function monthWeeks(anchor: ISODate): ISODate[][] {
  const d = parseISO(anchor);
  const first = toISODate(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const weeks: ISODate[][] = [];
  for (let start = weekStart(first); start <= last; start = addDays(start, 7)) weeks.push(weekDates(start));
  return weeks;
}

/** Same day of the month, `n` months away (clamped to the month's length). */
export function addMonths(date: ISODate, n: number): ISODate {
  const d = parseISO(date);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const days = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), days));
  return toISODate(target);
}
