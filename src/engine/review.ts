/**
 * Review analytics: time by goal, plan vs. actual, weekly summary, and the
 * feedback signals that flow back into scoring (diminishing returns) and
 * scheduling (duration calibration).
 */
import type { ActualEntry, AppData, DayPlan, Goal, ISODate, Task } from '../domain/types';
import { addDays, daysBetween, fmtDuration } from '../domain/time';
import { goalWeight } from './scoring';

export function goalOfActual(a: ActualEntry, tasksById: Map<string, Task>): string {
  return a.goalId ?? (a.taskId ? tasksById.get(a.taskId)?.goalIds[0] : undefined) ?? '_none';
}

export function minutesByGoal(actuals: ActualEntry[], tasks: Task[], from: ISODate, to: ISODate): Record<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const out: Record<string, number> = {};
  for (const a of actuals) {
    if (a.date < from || a.date > to || a.distraction) continue;
    const g = goalOfActual(a, byId);
    out[g] = (out[g] ?? 0) + a.minutes;
  }
  return out;
}

export function recentGoalMinutes(actuals: ActualEntry[], tasks: Task[], today: ISODate) {
  return minutesByGoal(actuals, tasks, addDays(today, -7), addDays(today, -1));
}

/** Median actual/estimate ratio per goal, once there are ≥3 samples. */
export function estimateFactors(tasks: Task[]): Record<string, number> {
  const samples: Record<string, number[]> = {};
  for (const t of tasks) {
    if (t.status !== 'completed' || !t.actualMin || !t.durationMin || !t.goalIds[0]) continue;
    (samples[t.goalIds[0]] ??= []).push(t.actualMin / t.durationMin);
  }
  const out: Record<string, number> = {};
  for (const [g, xs] of Object.entries(samples)) {
    if (xs.length < 3) continue;
    const s = [...xs].sort((a, b) => a - b);
    out[g] = Math.min(1.5, Math.max(0.8, s[Math.floor(s.length / 2)]));
  }
  return out;
}

export interface PlanVsActual {
  plannedTasks: number;
  completedTasks: number;
  plannedMin: number;
  actualMin: number;
  rows: { taskId: string; title: string; planned: number; actual: number; done: boolean }[];
}

export function planVsActual(plan: DayPlan | undefined, tasks: Task[], actuals: ActualEntry[], date: ISODate): PlanVsActual {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const planned = new Map<string, number>();
  for (const b of plan?.blocks ?? [])
    if (b.type === 'task' && b.taskId && b.status !== 'rejected')
      planned.set(b.taskId, (planned.get(b.taskId) ?? 0) + (b.end - b.start));
  const actualBy = new Map<string, number>();
  for (const a of actuals) if (a.date === date && a.taskId) actualBy.set(a.taskId, (actualBy.get(a.taskId) ?? 0) + a.minutes);
  const ids = new Set([...planned.keys(), ...actualBy.keys()]);
  const rows = [...ids].map((id) => {
    const t = byId.get(id);
    const done = !!t && (t.completedAt === date || t.lastDoneOn === date);
    return { taskId: id, title: t?.title ?? 'Deleted task', planned: planned.get(id) ?? 0, actual: actualBy.get(id) ?? 0, done };
  });
  return {
    plannedTasks: planned.size,
    completedTasks: rows.filter((r) => r.done && r.planned > 0).length,
    plannedMin: [...planned.values()].reduce((a, b) => a + b, 0),
    actualMin: [...actualBy.values()].reduce((a, b) => a + b, 0),
    rows,
  };
}

export interface WeeklySummary {
  weekStart: ISODate;
  weekEnd: ISODate;
  byGoal: { goal: Goal; minutes: number; share: number; fairShare: number; completed: number; milestonesDone: number }[];
  unlinkedMin: number;
  distractionMin: number;
  distractions: { title: string; minutes: number }[];
  outcomes: { task: Task }[];
  postponed: Task[];
  bottleneckChanged: boolean;
  completionRate: number | null;
  recommendations: string[];
}

export function weeklySummary(data: AppData, weekStartDate: ISODate): WeeklySummary {
  const weekEnd = addDays(weekStartDate, 6);
  const inWeek = (d?: ISODate) => !!d && d >= weekStartDate && d <= weekEnd;
  const mins = minutesByGoal(data.actuals, data.tasks, weekStartDate, weekEnd);
  const total = Object.values(mins).reduce((a, b) => a + b, 0);
  const active = data.goals.filter((g) => g.status === 'active').sort((a, b) => a.order - b.order);
  const wSum = active.reduce((s, g) => s + goalWeight(g, data.goals), 0) || 1;
  const completedThisWeek = data.tasks.filter((t) => t.status === 'completed' && inWeek(t.completedAt));

  const byGoal = active.map((goal) => ({
    goal,
    minutes: mins[goal.id] ?? 0,
    share: total ? (mins[goal.id] ?? 0) / total : 0,
    fairShare: goalWeight(goal, data.goals) / wSum,
    completed: completedThisWeek.filter((t) => t.goalIds.includes(goal.id)).length,
    milestonesDone: goal.milestones.filter((m) => m.done && inWeek(m.dueDate)).length,
  }));

  const distractionEntries = data.actuals.filter((a) => inWeek(a.date) && a.distraction);
  const dMap: Record<string, number> = {};
  for (const a of distractionEntries) dMap[a.title] = (dMap[a.title] ?? 0) + a.minutes;
  const distractions = Object.entries(dMap)
    .map(([title, minutes]) => ({ title, minutes }))
    .sort((a, b) => b.minutes - a.minutes);

  const outcomes = completedThisWeek
    .filter((t) => t.outcome || (t.impact ?? 0) >= 4)
    .sort((a, b) => (b.impact ?? 3) - (a.impact ?? 3))
    .slice(0, 5)
    .map((task) => ({ task }));

  const postponed = data.tasks
    .filter((t) => t.status !== 'completed' && t.status !== 'deferred' && t.postponeCount >= 2)
    .sort((a, b) => b.postponeCount - a.postponeCount);

  const bottleneckChanged = data.bottleneck.history.some((h) => inWeek(h.date));

  let planned = 0;
  let done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(weekStartDate, i);
    const r = data.dailyReviews[d];
    if (!r) continue;
    planned += r.completedTaskIds.length + r.missedTaskIds.length;
    done += r.completedTaskIds.length;
  }

  const recommendations: string[] = [];
  const under = byGoal
    .filter((g) => g.fairShare >= 0.12 && g.share < g.fairShare * 0.5 && !g.goal.sustaining)
    .sort((a, b) => b.fairShare - a.fairShare);
  for (const u of under.slice(0, 2))
    recommendations.push(
      `${u.goal.name} got ${Math.round(u.share * 100)}% of tracked time against a ~${Math.round(
        u.fairShare * 100,
      )}% priority share. Put one protected block on it early next week.`,
    );
  const over = byGoal.find((g) => total > 300 && g.share > g.fairShare * 2 && g.share > 0.3);
  if (over)
    recommendations.push(
      `${over.goal.name} took ${Math.round(over.share * 100)}% of your time. If that wasn't a deliberate sprint, cap it next week.`,
    );
  for (const p of postponed.slice(0, 2))
    recommendations.push(
      `“${p.title}” has been postponed ${p.postponeCount}×. Break it into a 25-minute first step, schedule it first thing, or consciously drop it.`,
    );
  if (distractions[0] && distractions[0].minutes >= 120)
    recommendations.push(
      `“${distractions[0].title}” cost ${fmtDuration(distractions[0].minutes)}. Decide on one structural change (blocker, phone out of reach, set time).`,
    );
  const sustaining = byGoal.filter((g) => g.goal.sustaining && g.minutes === 0);
  for (const s of sustaining.slice(0, 1))
    recommendations.push(`Nothing was logged for ${s.goal.name}. Schedule it as a commitment so it isn't the first thing squeezed.`);
  if (!recommendations.length)
    recommendations.push('Allocation roughly matches your priorities. Keep the same structure and raise the bar on one key outcome.');

  return {
    weekStart: weekStartDate,
    weekEnd,
    byGoal,
    unlinkedMin: mins['_none'] ?? 0,
    distractionMin: distractionEntries.reduce((s, a) => s + a.minutes, 0),
    distractions,
    outcomes,
    postponed,
    bottleneckChanged,
    completionRate: planned ? done / planned : null,
    recommendations,
  };
}

/** Daily progress series per goal for the last N days (for the trend view). */
export function goalTrend(data: AppData, today: ISODate, days = 28) {
  const start = addDays(today, -(days - 1));
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const weeks: { weekStart: ISODate; byGoal: Record<string, number> }[] = [];
  for (const a of data.actuals) {
    if (a.date < start || a.date > today || a.distraction) continue;
    const w = Math.floor(daysBetween(start, a.date) / 7);
    weeks[w] ??= { weekStart: addDays(start, w * 7), byGoal: {} };
    const g = goalOfActual(a, byId);
    weeks[w].byGoal[g] = (weeks[w].byGoal[g] ?? 0) + a.minutes;
  }
  for (let i = 0; i < Math.ceil(days / 7); i++) weeks[i] ??= { weekStart: addDays(start, i * 7), byGoal: {} };
  return weeks;
}
