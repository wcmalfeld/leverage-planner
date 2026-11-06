/**
 * Is my time going to my goals? The weekly scorecard (target vs planned vs actual
 * per goal, plus time that served no goal), drift alerts, and stalled-goal checks.
 */
import type { AppData, Goal, ISODate } from '../domain/types';
import { addDays, weekStart } from '../domain/time';
import { commitmentsForDate } from './availability';
import { activeGoals, goalWeight, isOpen, type RankedTask } from './scoring';
import { goalOfActual } from './review';
import { isSnoozed } from './triage';

export interface GoalTarget {
  share: number; // 0–1 of goal time
  explicit: boolean; // set by you, or implied by importance and order
}

/**
 * Target share of goal time per active goal. Goals with a target you set keep it;
 * whatever is left is split across the rest by importance and order.
 */
export function goalTargets(goals: Goal[]): Map<string, GoalTarget> {
  const active = activeGoals(goals);
  const set = active.filter((g) => g.targetShare !== undefined);
  const unset = active.filter((g) => g.targetShare === undefined);
  const explicitSum = set.reduce((s, g) => s + Math.max(0, g.targetShare!) / 100, 0);
  const rest = Math.max(0, 1 - explicitSum);
  const wSum = unset.reduce((s, g) => s + goalWeight(g, goals), 0) || 1;
  const raw = new Map<string, GoalTarget>();
  for (const g of set) raw.set(g.id, { share: Math.max(0, g.targetShare!) / 100, explicit: true });
  for (const g of unset) raw.set(g.id, { share: (rest * goalWeight(g, goals)) / wSum, explicit: false });
  const total = [...raw.values()].reduce((s, t) => s + t.share, 0);
  if (total > 0) for (const t of raw.values()) t.share /= total;
  return raw;
}

export interface ScoreRow {
  goal: Goal;
  target: GoalTarget;
  plannedMin: number;
  actualMin: number;
  /** Shares of goal time (not of all time). */
  plannedShare: number;
  actualShare: number;
}

export interface Scorecard {
  from: ISODate;
  to: ISODate;
  rows: ScoreRow[];
  goalMin: number;
  /** Logged time linked to no goal. */
  unlinkedMin: number;
  distractionMin: number;
  /** Goal time ÷ all logged time; null when nothing is logged. */
  alignedPct: number | null;
}

const counts = (status: string) => status !== 'rejected' && status !== 'skipped';

/** Planned minutes per goal from saved plans: task blocks and goal-linked commitments. */
function plannedByGoal(data: AppData, from: ISODate, to: ISODate): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [date, plan] of Object.entries(data.plans)) {
    if (date < from || date > to) continue;
    for (const b of plan.blocks) {
      if ((b.type !== 'task' && b.type !== 'commitment') || !b.goalIds[0] || !counts(b.status)) continue;
      out[b.goalIds[0]] = (out[b.goalIds[0]] ?? 0) + b.end - b.start;
    }
  }
  return out;
}

export function scorecard(data: AppData, from: ISODate, to: ISODate): Scorecard {
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const actual: Record<string, number> = {};
  let distractionMin = 0;
  for (const a of data.actuals) {
    if (a.date < from || a.date > to) continue;
    if (a.distraction) distractionMin += a.minutes;
    else {
      const g = goalOfActual(a, byId);
      actual[g] = (actual[g] ?? 0) + a.minutes;
    }
  }
  const planned = plannedByGoal(data, from, to);
  const targets = goalTargets(data.goals);
  const goals = activeGoals(data.goals).sort((a, b) => a.order - b.order);
  const goalMin = goals.reduce((s, g) => s + (actual[g.id] ?? 0), 0);
  const plannedTotal = goals.reduce((s, g) => s + (planned[g.id] ?? 0), 0);
  // Time on paused or deleted goals counts as unlinked: it isn't serving an active goal.
  const unlinkedMin = Object.entries(actual).reduce((s, [id, m]) => s + (goals.some((g) => g.id === id) ? 0 : m), 0);
  const all = goalMin + unlinkedMin + distractionMin;
  return {
    from,
    to,
    rows: goals.map((goal) => ({
      goal,
      target: targets.get(goal.id) ?? { share: 0, explicit: false },
      plannedMin: planned[goal.id] ?? 0,
      actualMin: actual[goal.id] ?? 0,
      plannedShare: plannedTotal ? (planned[goal.id] ?? 0) / plannedTotal : 0,
      actualShare: goalMin ? (actual[goal.id] ?? 0) / goalMin : 0,
    })),
    goalMin,
    unlinkedMin,
    distractionMin,
    alignedPct: all ? goalMin / all : null,
  };
}

/** This week so far (Monday through today). */
export const weekScorecard = (data: AppData, today: ISODate) => scorecard(data, weekStart(today), today);

export interface Drift {
  goal: Goal;
  target: number;
  shares: [number, number]; // the two most recent full weeks, older first
}

/**
 * Goals well under their target share two full weeks running. One bad week is noise;
 * two is a pattern. Sustaining goals are skipped unless you set a target, since their
 * time usually lives in commitments rather than the log.
 */
export function driftAlerts(data: AppData, today: ISODate, tolerance = 0.6): Drift[] {
  const w1 = addDays(weekStart(today), -14);
  const w2 = addDays(weekStart(today), -7);
  const a = scorecard(data, w1, addDays(w1, 6));
  const b = scorecard(data, w2, addDays(w2, 6));
  if (a.goalMin < 60 || b.goalMin < 60) return [];
  return a.rows
    .map((r) => ({ r, s: b.rows.find((x) => x.goal.id === r.goal.id)! }))
    .filter(({ r }) => (!r.goal.sustaining || r.target.explicit) && r.target.share >= 0.08)
    .filter(({ r, s }) => r.actualShare < r.target.share * tolerance && s.actualShare < s.target.share * tolerance)
    .map(({ r, s }) => ({ goal: r.goal, target: s.target.share, shares: [r.actualShare, s.actualShare] as [number, number] }))
    .sort((x, y) => y.target - x.target);
}

export type StallReason = 'no-next-action' | 'no-progress' | 'not-scheduled';

export interface Stall {
  goal: Goal;
  reason: StallReason;
  detail: string;
  /** Its best open task, for a one-click "do it today". */
  topTaskId?: string;
}

/**
 * Goals that are quietly fading: no next action, nothing done in 14 days, or nothing
 * on the calendar this week. Goals served by a recurring commitment (a weekly ride,
 * a standing call) are already scheduled, so they're skipped.
 */
export function stalledGoals(data: AppData, today: ISODate, ranked: RankedTask[] = []): Stall[] {
  const ws = weekStart(today);
  const week = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const since = addDays(today, -13);
  const byId = new Map(data.tasks.map((t) => [t.id, t]));
  const out: Stall[] = [];

  for (const goal of activeGoals(data.goals).sort((a, b) => a.order - b.order)) {
    const linked = data.commitments.filter((c) => c.goalId === goal.id);
    if (week.some((d) => commitmentsForDate(linked, d).length)) continue;

    const open = data.tasks.filter((t) => t.goalIds.includes(goal.id) && isOpen(t) && !isSnoozed(t, today));
    if (!open.length) {
      out.push({ goal, reason: 'no-next-action', detail: 'No next action, so nothing for it can be scheduled.' });
      continue;
    }
    const top = ranked.find((r) => r.task.goalIds.includes(goal.id) && !r.result.blocked && !isSnoozed(r.task, today))?.task ?? open[0];

    const loggedSince = (from: ISODate) => data.actuals.some((a) => !a.distraction && a.date >= from && a.date <= today && goalOfActual(a, byId) === goal.id);
    const doneSince = (from: ISODate) => data.tasks.some((t) => t.goalIds.includes(goal.id) && ((t.completedAt ?? '') >= from || (t.lastDoneOn ?? '') >= from));
    if (!loggedSince(since) && !doneSince(since)) {
      out.push({ goal, reason: 'no-progress', detail: 'Nothing logged or finished in 14 days.', topTaskId: top.id });
      continue;
    }

    const scheduled = week.some((d) =>
      data.plans[d]?.blocks.some((b) => b.type === 'task' && b.goalIds.includes(goal.id) && counts(b.status)),
    );
    if (!scheduled && !loggedSince(ws) && !doneSince(ws))
      out.push({ goal, reason: 'not-scheduled', detail: 'Nothing scheduled or done for it this week.', topTaskId: top.id });
  }
  return out;
}

export const STALL_LABEL: Record<StallReason, string> = {
  'no-next-action': 'No next action',
  'no-progress': 'Stalled 14 days',
  'not-scheduled': 'Not scheduled this week',
};
