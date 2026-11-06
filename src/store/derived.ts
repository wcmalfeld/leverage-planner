/**
 * Glue between stored data and the pure engines. Everything here is memoised per
 * data snapshot so views can call it freely.
 */
import { useMemo } from 'react';
import type { AppData, DayPlan, ISODate, Task } from '../domain/types';
import { rankTasks, type RankedTask } from '../engine/scoring';
import { classifyTask, type Classification } from '../engine/classify';
import { generatePlan } from '../engine/scheduler';
import { compareDay, type Comparison } from '../engine/compare';
import { estimateFactors, recentGoalMinutes } from '../engine/review';
import { stopOrPostpone, strategicNote, topThree, type StopItem, type TopAction } from '../engine/insights';
import { store, useApp } from './store';

/** Cheap stable hash for staleness detection. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function planSignature(data: AppData): string {
  const tasks = data.tasks.map((t) => [t.id, t.status, t.durationMin, t.deadline, t.impact, t.confidence, t.compounding, t.goalIds, t.dependsOn, t.energy, t.location, t.removesBottleneck, t.splittable, t.tierOverride, t.recurrence, t.lastDoneOn, t.snoozedUntil, t.keepBelowBar, t.plannedFor]);
  const { nudges: _n, ...settings } = data.settings; // nudges don't change the plan
  return hash(JSON.stringify([tasks, data.commitments, settings, data.goals.map((g) => [g.id, g.importance, g.order, g.status]), data.bottleneck.goalIds]));
}

export function buildPlan(data: AppData, date: ISODate, previous?: DayPlan): DayPlan {
  const plan = generatePlan({
    date,
    tasks: data.tasks,
    goals: data.goals,
    commitments: data.commitments,
    settings: data.settings,
    bottleneck: data.bottleneck.statement ? data.bottleneck : undefined,
    previous,
    recentGoalMinutes: recentGoalMinutes(data.actuals, data.tasks, date),
    estimateFactors: estimateFactors(data.tasks),
    makeId: (n) => `b_${date}_${Date.now().toString(36)}_${n}`,
  });
  return { ...plan, inputSig: planSignature(data) };
}

export function regenerate(date: ISODate) {
  const data = store.get();
  store.savePlan(buildPlan(data, date, data.plans[date]));
}

export interface Derived {
  ranked: RankedTask[];
  rankedById: Map<string, RankedTask>;
  classes: Map<string, Classification>;
  tasksById: Map<string, Task>;
  plan?: DayPlan;
  stale: boolean;
  comparison?: Comparison;
  top: TopAction[];
  stop: StopItem[];
  note: string;
}

export function useRanking(date: ISODate) {
  const data = useApp();
  return useMemo(() => {
    const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
    const ranked = rankTasks(data.tasks, data.settings.weights, {
      today: date,
      goals: data.goals,
      bottleneck: data.bottleneck.statement ? data.bottleneck : undefined,
      tasksById,
      recentGoalMinutes: recentGoalMinutes(data.actuals, data.tasks, date),
    });
    const rankedById = new Map(ranked.map((r) => [r.task.id, r]));
    const classes = new Map(ranked.map((r) => [r.task.id, classifyTask(r.task, r.result, data.goals)]));
    return { ranked, rankedById, classes, tasksById };
  }, [data.tasks, data.goals, data.settings.weights, data.bottleneck, data.actuals, date]);
}

export function useDerived(date: ISODate): Derived {
  const data = useApp();
  const ranking = useRanking(date);
  return useMemo(() => {
    const plan = data.plans[date];
    const stale = !!plan && plan.inputSig !== planSignature(data);
    const comparison = plan
      ? compareDay({
          date,
          plan,
          currentPlan: data.currentPlan,
          commitments: data.commitments,
          tasks: data.tasks,
          goals: data.goals,
          ranked: ranking.ranked,
          settings: data.settings,
        })
      : undefined;
    const top = topThree(plan, ranking.ranked, data.goals);
    const stop = stopOrPostpone(plan, ranking.ranked, data.goals, comparison);
    const note = strategicNote(plan, ranking.ranked, data.goals, data.bottleneck.statement ? data.bottleneck : undefined);
    return { ...ranking, plan, stale, comparison, top, stop, note };
  }, [data, date, ranking]);
}
