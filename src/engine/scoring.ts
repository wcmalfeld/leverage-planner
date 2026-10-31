/**
 * Prioritisation engine — deterministic, transparent, testable.
 *
 * score = 100 × Σ(wᵢ·fᵢ) / Σwᵢ × balance
 *
 * Every factor fᵢ ∈ [0,1] is computed from what the user entered. When a field
 * is missing we assume a neutral value and *say so* in the explanation, rather
 * than silently inventing precision. The score is a decision aid, not a truth.
 */
import type { Bottleneck, Goal, ISODate, Task, Weights } from '../domain/types';
import { daysBetween } from '../domain/time';

export type FactorKey = keyof Weights;

export const FACTOR_LABELS: Record<FactorKey, string> = {
  alignment: 'Goal alignment',
  impact: 'Impact if it works',
  compounding: 'Compounding value',
  urgency: 'Urgency / cost of delay',
  confidence: 'Likelihood of success',
  effort: 'Time efficiency',
  feasibility: 'Ready to act on',
  bottleneck: 'Removes the bottleneck',
};

export const DEFAULT_WEIGHTS: Weights = {
  alignment: 1.5,
  impact: 1.5,
  compounding: 1.2,
  urgency: 1.0,
  confidence: 0.8,
  effort: 0.5,
  feasibility: 0.7,
  bottleneck: 1.3,
};

/** Shown in Settings so the defaults are never a black box. */
export const WEIGHT_RATIONALE: Record<FactorKey, string> = {
  alignment:
    'Highest weight: an action only matters if it moves a goal you care about. Unlinked work is the classic "productive-looking" trap.',
  impact:
    'Equal-highest: a single client signed or job offer outweighs a dozen small tasks. Size of the upside matters more than ease.',
  compounding:
    'Skills, relationships, reputation and assets keep paying after the hour is spent, so they earn a premium over one-off wins.',
  urgency:
    'Deadlines and cost of delay matter, but deliberately less than value — otherwise the loudest task always wins.',
  confidence:
    'Expected value = impact × probability. Kept moderate so bold, uncertain bets are not crowded out entirely.',
  effort:
    'Deliberately low: it discounts very long tasks a little, but never lets "shortest first" dominate the ranking.',
  feasibility:
    'A vague or blocked task cannot be started today. Clarifying it into a concrete next action raises this factor.',
  bottleneck:
    'Removing the constraint that limits everything else unlocks progress across all goals, so it gets a strong boost.',
};

export interface ScoringContext {
  today: ISODate;
  goals: Goal[];
  bottleneck?: Bottleneck;
  tasksById: Map<string, Task>;
  /** Minutes completed per goal over the last ~7 days (for diminishing returns). */
  recentGoalMinutes?: Record<string, number>;
}

export interface FactorResult {
  key: FactorKey;
  label: string;
  value: number; // 0–1
  weight: number;
  contribution: number; // points out of 100
  note: string;
  assumed: boolean;
}

export interface ScoreResult {
  taskId: string;
  score: number; // 0–100
  raw: number; // before balance multiplier
  factors: FactorResult[];
  balance: { multiplier: number; note?: string };
  blocked: boolean;
  blockedBy: string[];
  primaryGoalId?: string;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const rating = (r: number | undefined, fallback = 3) => ((r ?? fallback) - 1) / 4;

export function activeGoals(goals: Goal[]) {
  return goals.filter((g) => g.status === 'active');
}

/** Normalised 0–1 importance for a goal, considering its rank among active goals. */
export function goalWeight(goal: Goal, goals: Goal[]): number {
  if (goal.status !== 'active') return goal.status === 'paused' ? 0.15 : 0;
  const active = activeGoals(goals).sort((a, b) => a.order - b.order);
  const rank = active.findIndex((g) => g.id === goal.id);
  const rankBonus = active.length > 1 ? (1 - rank / (active.length - 1)) * 0.1 : 0.1;
  return clamp(0.15 + ((goal.importance - 1) / 4) * 0.75 + rankBonus);
}

export function urgencyFromDeadline(deadline: ISODate | undefined, today: ISODate): { value: number; note: string } {
  if (!deadline) return { value: 0.15, note: 'No deadline — low cost of delay' };
  const d = daysBetween(today, deadline);
  if (d < 0) return { value: 1, note: `Overdue by ${-d} day${d === -1 ? '' : 's'}` };
  if (d === 0) return { value: 1, note: 'Due today' };
  if (d === 1) return { value: 0.9, note: 'Due tomorrow' };
  if (d <= 3) return { value: 0.75, note: `Due in ${d} days` };
  if (d <= 7) return { value: 0.55, note: `Due in ${d} days` };
  if (d <= 14) return { value: 0.35, note: `Due in ${d} days` };
  if (d <= 30) return { value: 0.25, note: `Due in ${d} days` };
  return { value: 0.15, note: `Due in ${d} days — plenty of runway` };
}

/** 30m → 1.0, 1h → .8, 2h → .6, 4h → .4, 8h+ → .2. Gentle on purpose. */
export function effortEfficiency(durationMin: number | undefined): { value: number; note: string; assumed: boolean } {
  const d = durationMin ?? 45;
  const v = clamp(1 - Math.max(0, Math.log2(d / 30)) * 0.2, 0.2, 1);
  return {
    value: v,
    assumed: durationMin === undefined,
    note: durationMin === undefined ? 'Duration not estimated (assumed ~45m)' : `${d} min estimated`,
  };
}

export function unmetDependencies(task: Task, tasksById: Map<string, Task>): string[] {
  return task.dependsOn.filter((id) => {
    const dep = tasksById.get(id);
    return dep !== undefined && dep.status !== 'completed';
  });
}

export function scoreTask(task: Task, weights: Weights, ctx: ScoringContext): ScoreResult {
  const goalsById = new Map(ctx.goals.map((g) => [g.id, g]));
  const linked = task.goalIds.map((id) => goalsById.get(id)).filter((g): g is Goal => !!g);

  // Alignment
  let alignment = 0.1;
  let alignNote = 'Not linked to any goal';
  let primaryGoal: Goal | undefined;
  if (linked.length) {
    const ranked = linked.map((g) => ({ g, w: goalWeight(g, ctx.goals) })).sort((a, b) => b.w - a.w);
    primaryGoal = ranked[0].g;
    // Small bonus for genuinely serving two goals at once.
    alignment = clamp(ranked[0].w + (ranked[1] ? ranked[1].w * 0.15 : 0));
    alignNote =
      `Advances ${ranked.map((r) => r.g.name).join(' + ')}` +
      (primaryGoal.status !== 'active' ? ` (goal is ${primaryGoal.status})` : '');
  }

  const impact = rating(task.impact);
  const compounding = rating(task.compounding);
  const confidence = rating(task.confidence);
  const urgency = urgencyFromDeadline(task.deadline, ctx.today);
  const effort = effortEfficiency(task.durationMin);

  // Feasibility: blocked tasks can't be started; vague tasks are harder to start.
  const blockedBy = unmetDependencies(task, ctx.tasksById);
  let feasibility = 1;
  const feasNotes: string[] = [];
  if (blockedBy.length) {
    feasibility = 0;
    feasNotes.push(`Waiting on ${blockedBy.length} prerequisite${blockedBy.length > 1 ? 's' : ''}`);
  } else {
    if (!task.expectedResult) {
      feasibility -= 0.3;
      feasNotes.push('no clear "done" definition');
    }
    if (task.durationMin === undefined) {
      feasibility -= 0.2;
      feasNotes.push('no time estimate');
    }
    if (task.postponeCount >= 3) {
      feasibility -= 0.15;
      feasNotes.push(`postponed ${task.postponeCount}×`);
    }
  }
  feasibility = clamp(feasibility);

  // Bottleneck
  let bottleneck = 0;
  let bnNote = 'Not tied to the current bottleneck';
  if (task.removesBottleneck) {
    bottleneck = 1;
    bnNote = 'Directly attacks the current bottleneck';
  } else if (ctx.bottleneck && task.goalIds.some((id) => ctx.bottleneck!.goalIds.includes(id))) {
    bottleneck = 0.5;
    bnNote = 'Serves a goal involved in the bottleneck';
  }

  const parts: Omit<FactorResult, 'contribution' | 'label'>[] = [
    { key: 'alignment', value: alignment, weight: weights.alignment, note: alignNote, assumed: false },
    {
      key: 'impact',
      value: impact,
      weight: weights.impact,
      note: task.impact ? `Impact rated ${task.impact}/5` : 'Impact not rated (assumed 3/5)',
      assumed: task.impact === undefined,
    },
    {
      key: 'compounding',
      value: compounding,
      weight: weights.compounding,
      note: task.compounding ? `Compounding rated ${task.compounding}/5` : 'Compounding not rated (assumed 3/5)',
      assumed: task.compounding === undefined,
    },
    { key: 'urgency', value: urgency.value, weight: weights.urgency, note: urgency.note, assumed: false },
    {
      key: 'confidence',
      value: confidence,
      weight: weights.confidence,
      note: task.confidence ? `Confidence ${task.confidence}/5` : 'Confidence not rated (assumed 3/5)',
      assumed: task.confidence === undefined,
    },
    { key: 'effort', value: effort.value, weight: weights.effort, note: effort.note, assumed: effort.assumed },
    {
      key: 'feasibility',
      value: feasibility,
      weight: weights.feasibility,
      note: feasNotes.length ? feasNotes.join('; ') : 'Concrete and ready to start',
      assumed: false,
    },
    { key: 'bottleneck', value: bottleneck, weight: weights.bottleneck, note: bnNote, assumed: false },
  ];

  const totalW = parts.reduce((s, p) => s + Math.max(0, p.weight), 0) || 1;
  const factors: FactorResult[] = parts.map((p) => ({
    ...p,
    label: FACTOR_LABELS[p.key],
    contribution: (100 * Math.max(0, p.weight) * p.value) / totalW,
  }));
  const raw = factors.reduce((s, f) => s + f.contribution, 0);

  // Diminishing returns: if a goal has already had far more than its fair share of
  // recent time, nudge its tasks down (max −15%) so the plan doesn't fixate.
  const balance = balanceMultiplier(primaryGoal, ctx);

  return {
    taskId: task.id,
    score: Math.round(raw * balance.multiplier * 10) / 10,
    raw,
    factors,
    balance,
    blocked: blockedBy.length > 0,
    blockedBy,
    primaryGoalId: primaryGoal?.id,
  };
}

export function balanceMultiplier(goal: Goal | undefined, ctx: ScoringContext): { multiplier: number; note?: string } {
  const recent = ctx.recentGoalMinutes;
  if (!goal || !recent) return { multiplier: 1 };
  const total = Object.values(recent).reduce((a, b) => a + b, 0);
  if (total < 240) return { multiplier: 1 }; // not enough history to judge
  const active = activeGoals(ctx.goals);
  const wSum = active.reduce((s, g) => s + goalWeight(g, ctx.goals), 0) || 1;
  const fair = goalWeight(goal, ctx.goals) / wSum;
  const actual = (recent[goal.id] ?? 0) / total;
  if (actual <= fair * 1.5) return { multiplier: 1 };
  const over = Math.min(1, (actual - fair * 1.5) / Math.max(0.01, fair * 1.5));
  const multiplier = 1 - 0.15 * over;
  return {
    multiplier,
    note: `${goal.name} got ${Math.round(actual * 100)}% of your tracked time this week vs ~${Math.round(
      fair * 100,
    )}% its weight suggests — slight nudge toward other goals`,
  };
}

export interface RankedTask {
  task: Task;
  result: ScoreResult;
  rank: number;
}

export const isOpen = (t: Task) => t.status !== 'completed' && t.status !== 'deferred';

export function rankTasks(tasks: Task[], weights: Weights, ctx: ScoringContext): RankedTask[] {
  return tasks
    .filter(isOpen)
    .map((task) => ({ task, result: scoreTask(task, weights, ctx) }))
    .sort((a, b) => {
      if (a.result.blocked !== b.result.blocked) return a.result.blocked ? 1 : -1;
      return b.result.score - a.result.score || a.task.title.localeCompare(b.task.title);
    })
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/**
 * Plain-language comparison: why does A rank above B? Returns the factors where A
 * beats B by the most weighted points.
 */
export function whyAbove(a: ScoreResult, b: ScoreResult, max = 2): string[] {
  const diffs = a.factors
    .map((f) => {
      const other = b.factors.find((x) => x.key === f.key)!;
      return { f, delta: f.contribution - other.contribution };
    })
    .filter((d) => d.delta > 0.5)
    .sort((x, y) => y.delta - x.delta)
    .slice(0, max);
  return diffs.map((d) => `${d.f.label.toLowerCase()} (+${d.delta.toFixed(1)} pts)`);
}

/** The 2–3 factors that contribute most, for compact "because…" lines. */
export function topReasons(r: ScoreResult, max = 3): FactorResult[] {
  return [...r.factors]
    .filter((f) => f.value > 0.45 && f.contribution > 3)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, max);
}
