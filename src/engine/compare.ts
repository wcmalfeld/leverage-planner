/**
 * Current plan vs recommended plan: allocation by goal, missing leverage,
 * low-value time, and a ranked list of concrete changes.
 */
import type { Block, Commitment, CurrentBlock, CurrentValue, DayPlan, Goal, ISODate, Settings, Task } from '../domain/types';
import { dayOfWeek, fmtDuration, fmtTime } from '../domain/time';
import { energyAt, overlaps } from './availability';
import { commitmentsForDate } from './availability';
import type { RankedTask } from './scoring';
import { goalWeight } from './scoring';
import { classifyTask } from './classify';

export interface AllocationRow {
  key: string;
  label: string;
  color?: string;
  current: number;
  recommended: number;
}

export type ChangeKind = 'add' | 'protect' | 'reduce' | 'remove' | 'move' | 'replace';

export interface Change {
  kind: ChangeKind;
  title: string;
  detail: string;
  value: number; // relative importance, used for ranking only
  goalId?: string;
}

export interface Comparison {
  date: ISODate;
  current: CurrentBlock[];
  commitments: Commitment[];
  allocation: AllocationRow[];
  missing: { taskId: string; title: string; minutes: number; score: number; goalId?: string }[];
  lowValue: { block: CurrentBlock; minutes: number; reason: string }[];
  changes: Change[];
  headline: string[];
}

export function currentBlocksFor(current: CurrentBlock[], date: ISODate): CurrentBlock[] {
  const dow = dayOfWeek(date);
  const dated = current.filter((c) => c.date === date);
  // A dated entry for the day replaces any typical-week entry it overlaps.
  const typical = current.filter((c) => !c.date && c.days.includes(dow) && !dated.some((d) => overlaps(d, c)));
  return [...typical, ...dated].sort((a, b) => a.start - b.start);
}

export function valueOf(
  b: CurrentBlock,
  tasksById: Map<string, Task>,
  rankedById: Map<string, RankedTask>,
  goals: Goal[],
): { value: CurrentValue; reason: string } {
  if (b.value) return { value: b.value, reason: 'You labelled it' };
  if (b.taskId) {
    const r = rankedById.get(b.taskId);
    const t = tasksById.get(b.taskId);
    if (r && t) {
      const tier = classifyTask(t, r.result, goals).tier;
      const map: Record<string, CurrentValue> = {
        protect: 'high',
        maintain: 'maintenance',
        obligation: 'maintenance',
        optional: 'low',
        reduce: 'distraction',
      };
      return { value: map[tier], reason: `Task ranked #${r.rank}` };
    }
  }
  if (b.goalId) {
    const g = goals.find((x) => x.id === b.goalId);
    if (g) {
      if (g.sustaining) return { value: 'essential', reason: `Sustains ${g.name}` };
      return goalWeight(g, goals) >= 0.6
        ? { value: 'high', reason: `Serves ${g.name}` }
        : { value: 'maintenance', reason: `Serves ${g.name} (lower priority)` };
    }
  }
  return { value: 'low', reason: 'Not linked to any goal' };
}

const mins = (x: { start: number; end: number }) => Math.max(0, x.end - x.start);

export function compareDay(args: {
  date: ISODate;
  plan: DayPlan;
  currentPlan: CurrentBlock[];
  commitments: Commitment[];
  tasks: Task[];
  goals: Goal[];
  ranked: RankedTask[];
  settings: Settings;
}): Comparison {
  const { date, plan, goals, settings } = args;
  const tasksById = new Map(args.tasks.map((t) => [t.id, t]));
  const rankedById = new Map(args.ranked.map((r) => [r.task.id, r]));
  const current = currentBlocksFor(args.currentPlan, date);
  const commitments = commitmentsForDate(args.commitments, date);
  const recTasks = plan.blocks.filter((b) => b.type === 'task' && b.status !== 'rejected');

  // Allocation by goal (flexible time only — commitments are identical on both sides).
  const rows = new Map<string, AllocationRow>();
  const row = (key: string, label: string, color?: string) => {
    if (!rows.has(key)) rows.set(key, { key, label, color, current: 0, recommended: 0 });
    return rows.get(key)!;
  };
  for (const g of [...goals].sort((a, b) => a.order - b.order)) if (g.status === 'active') row(g.id, g.name, g.color);
  const goalOfCurrent = (b: CurrentBlock) => b.goalId ?? (b.taskId ? tasksById.get(b.taskId)?.goalIds[0] : undefined);
  for (const b of current) {
    const g = goalOfCurrent(b);
    const r = g && rows.has(g) ? rows.get(g)! : row('_none', 'Not linked to a goal');
    r.current += mins(b);
  }
  for (const b of recTasks) {
    const g = b.goalIds[0];
    const r = g && rows.has(g) ? rows.get(g)! : row('_none', 'Not linked to a goal');
    r.recommended += mins(b);
  }
  const allocation = [...rows.values()];

  // Missing leverage: recommended work with no counterpart in the current plan.
  const missing: Comparison['missing'] = [];
  const seen = new Set<string>();
  for (const b of recTasks) {
    if (!b.taskId || seen.has(b.taskId)) continue;
    seen.add(b.taskId);
    const inCurrent = current.some((c) => c.taskId === b.taskId);
    if (inCurrent) continue;
    const r = rankedById.get(b.taskId);
    const minutes = recTasks.filter((x) => x.taskId === b.taskId).reduce((s, x) => s + mins(x), 0);
    missing.push({ taskId: b.taskId, title: b.title, minutes, score: r?.result.score ?? 0, goalId: b.goalIds[0] });
  }
  missing.sort((a, b) => b.score - a.score);

  // Low-value time in the current plan.
  const lowValue: Comparison['lowValue'] = [];
  for (const b of current) {
    const v = valueOf(b, tasksById, rankedById, goals);
    if ((v.value === 'low' || v.value === 'distraction') && mins(b) >= 30)
      lowValue.push({ block: b, minutes: mins(b), reason: v.value === 'distraction' ? 'Marked as a distraction' : v.reason });
  }
  lowValue.sort((a, b) => b.minutes - a.minutes);

  // Ranked changes.
  const changes: Change[] = [];
  const replaced = new Set<string>();
  for (const m of missing) {
    const g = goals.find((x) => x.id === m.goalId);
    const overlapLow = lowValue.find((l) =>
      !replaced.has(l.block.id) && recTasks.some((rb) => rb.taskId === m.taskId && overlaps(rb, l.block)),
    );
    if (overlapLow) replaced.add(overlapLow.block.id);
    if (overlapLow) {
      changes.push({
        kind: 'replace',
        title: `Replace “${overlapLow.block.title}” with “${m.title}”`,
        detail: `${fmtTime(overlapLow.block.start)}–${fmtTime(overlapLow.block.end)} is currently ${overlapLow.reason.toLowerCase()}; the same slot could advance ${g?.name ?? 'a goal'} (score ${Math.round(m.score)}).`,
        value: m.score * (m.minutes / 60) + 15,
        goalId: m.goalId,
      });
    } else {
      changes.push({
        kind: 'add',
        title: `Add “${m.title}” (${fmtDuration(m.minutes)})`,
        detail: `Not in your current plan. Advances ${g?.name ?? 'no linked goal'} — leverage score ${Math.round(m.score)}.`,
        value: m.score * (m.minutes / 60),
        goalId: m.goalId,
      });
    }
  }
  for (const l of lowValue) {
    if (changes.some((c) => c.kind === 'replace' && c.title.includes(`“${l.block.title}”`))) continue;
    const distraction = l.reason === 'Marked as a distraction';
    changes.push({
      kind: distraction ? 'remove' : 'reduce',
      title: `${distraction ? 'Cut' : 'Shrink'} “${l.block.title}” (${fmtDuration(l.minutes)})`,
      detail: `${l.reason}. ${distraction ? 'Removing it' : 'Halving it'} frees ${fmtDuration(
        distraction ? l.minutes : Math.round(l.minutes / 2),
      )} for higher-leverage work or real rest.`,
      value: (l.minutes / 60) * (distraction ? 40 : 22),
    });
  }
  // Moves: tasks in both plans at different times where the recommended slot fits energy better.
  for (const c of current.filter((c) => c.taskId)) {
    const rb = recTasks.find((b) => b.taskId === c.taskId);
    const t = tasksById.get(c.taskId!);
    if (!rb || !t || Math.abs(rb.start - c.start) < 30) continue;
    const need = t.energy ?? 'medium';
    const before = energyAt(settings, c.start);
    const after = energyAt(settings, rb.start);
    const better = need === 'high' && after === 'high' && before !== 'high';
    changes.push({
      kind: 'move',
      title: `Move “${t.title}” from ${fmtTime(c.start)} to ${fmtTime(rb.start)}`,
      detail: better
        ? 'It needs high energy; the new slot is in one of your peak periods.'
        : 'Groups it with related work and reduces context switching.',
      value: better ? 25 : 8,
      goalId: t.goalIds[0],
    });
  }
  // Protect: high-value or essential current blocks that should survive pressure.
  for (const c of current) {
    const v = valueOf(c, tasksById, rankedById, goals);
    if (v.value === 'essential' || (v.value === 'high' && c.taskId && recTasks.some((b) => b.taskId === c.taskId)))
      changes.push({
        kind: 'protect',
        title: `Protect “${c.title}”`,
        detail: v.value === 'essential' ? `${v.reason} — keep it even on busy days.` : `${v.reason}; it's already in the right place.`,
        value: 10,
        goalId: c.goalId,
      });
  }
  for (const c of commitments.filter((c) => c.essential && (c.kind === 'exercise' || c.kind === 'social' || c.kind === 'rest')))
    changes.push({
      kind: 'protect',
      title: `Protect “${c.title}”`,
      detail: 'Recovery, health and relationships are part of the plan, not slack to be harvested.',
      value: 9,
    });

  changes.sort((a, b) => b.value - a.value);

  const headline: string[] = [];
  const curLinked = allocation.filter((r) => r.key !== '_none').reduce((s, r) => s + r.current, 0);
  const recLinked = allocation.filter((r) => r.key !== '_none').reduce((s, r) => s + r.recommended, 0);
  if (recLinked > curLinked)
    headline.push(`The recommended plan puts ${fmtDuration(recLinked - curLinked)} more into your goals.`);
  const biggest = [...allocation].sort((a, b) => b.recommended - b.current - (a.recommended - a.current))[0];
  if (biggest && biggest.recommended - biggest.current >= 30)
    headline.push(`Biggest shift: +${fmtDuration(biggest.recommended - biggest.current)} toward ${biggest.label}.`);
  const lowTotal = lowValue.reduce((s, l) => s + l.minutes, 0);
  if (lowTotal >= 45) headline.push(`${fmtDuration(lowTotal)} of your current plan has a weak link to your goals.`);
  if (!current.length) headline.push('Your current plan is empty for this day — add your typical routine in Compare to see real differences.');

  return { date, current, commitments, allocation, missing, lowValue, changes, headline };
}

export function blockMinutesByGoal(blocks: Block[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of blocks) {
    if (b.type !== 'task') continue;
    const g = b.goalIds[0] ?? '_none';
    out[g] = (out[g] ?? 0) + mins(b);
  }
  return out;
}
