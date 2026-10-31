/**
 * Daily brief: the three highest-leverage actions, what to stop or postpone,
 * and why today's plan matters.
 */
import type { Block, Bottleneck, DayPlan, Goal, Task } from '../domain/types';
import { fmtDuration, fmtTime } from '../domain/time';
import { topReasons, whyAbove, type RankedTask } from './scoring';
import { classifyTask } from './classify';
import type { Comparison } from './compare';

export interface TopAction {
  task: Task;
  ranked: RankedTask;
  block?: Block;
  goal?: Goal;
  why: string;
  success: string;
  edge?: string;
}

export function topThree(plan: DayPlan | undefined, ranked: RankedTask[], goals: Goal[]): TopAction[] {
  const byId = new Map(ranked.map((r) => [r.task.id, r]));
  const scheduled = (plan?.blocks ?? [])
    .filter((b) => b.type === 'task' && b.taskId && b.status !== 'rejected' && byId.has(b.taskId))
    .filter((b, i, arr) => arr.findIndex((x) => x.taskId === b.taskId) === i);

  const picks: { r: RankedTask; block?: Block }[] = scheduled
    .map((b) => ({ r: byId.get(b.taskId!)!, block: b }))
    .sort((a, b) => b.r.result.score - a.r.result.score)
    .slice(0, 3);
  for (const r of ranked) {
    if (picks.length >= 3) break;
    if (!r.result.blocked && !picks.some((p) => p.r.task.id === r.task.id) && !plan) picks.push({ r });
  }

  const pickedIds = new Set(picks.map((p) => p.r.task.id));
  const runnerUp = ranked.find((r) => !pickedIds.has(r.task.id) && !r.result.blocked);

  return picks.map(({ r, block }) => {
    const goal = goals.find((g) => g.id === r.result.primaryGoalId);
    const reasons = topReasons(r.result).map((f) => f.note);
    const why = reasons.length ? reasons.join('; ') : 'Best available use of the time';
    const success =
      r.task.expectedResult?.trim() ||
      `“${r.task.title}” is finished${r.task.durationMin ? ` within ~${fmtDuration(r.task.durationMin)}` : ''} and logged with its outcome.`;
    const edgeParts = runnerUp ? whyAbove(r.result, runnerUp.result) : [];
    const edge = runnerUp && edgeParts.length ? `Beats “${runnerUp.task.title}” on ${edgeParts.join(' and ')}.` : undefined;
    return { task: r.task, ranked: r, block, goal, why, success, edge };
  });
}

export interface StopItem {
  title: string;
  reason: string;
  kind: 'current' | 'task' | 'busywork';
}

export function stopOrPostpone(
  plan: DayPlan | undefined,
  ranked: RankedTask[],
  goals: Goal[],
  comparison?: Comparison,
): StopItem[] {
  const out: StopItem[] = [];
  const top = new Set(topThree(plan, ranked, goals).map((t) => t.task.id));
  const topBlocks = (plan?.blocks ?? []).filter((b) => b.taskId && top.has(b.taskId));

  for (const l of comparison?.lowValue ?? []) {
    const clash = topBlocks.find((b) => b.start < l.block.end && l.block.start < b.end);
    out.push({
      kind: 'current',
      title: `${l.block.title} (${fmtTime(l.block.start)}, ${fmtDuration(l.minutes)})`,
      reason: clash ? `Overlaps the slot for “${clash.title}”. ${l.reason}.` : `${l.reason} — shrink or drop it today.`,
    });
  }
  for (const r of ranked) {
    const cls = classifyTask(r.task, r.result, goals);
    if (cls.busywork)
      out.push({ kind: 'busywork', title: r.task.title, reason: `${cls.busyworkReason}. Looks productive; weak goal link.` });
    else if (cls.tier === 'reduce') out.push({ kind: 'task', title: r.task.title, reason: cls.reason + ' — drop, automate or delegate.' });
  }
  const optionalUnplaced = (plan?.unscheduled ?? []).filter((u) => !u.important);
  for (const u of optionalUnplaced.slice(0, 3)) {
    const r = ranked.find((x) => x.task.id === u.taskId);
    if (!r || out.some((o) => o.title === r.task.title)) continue;
    out.push({ kind: 'task', title: r.task.title, reason: `Postpone: ranked #${r.rank}, nothing is lost by waiting a day.` });
  }
  return out.slice(0, 6);
}

export function strategicNote(
  plan: DayPlan | undefined,
  ranked: RankedTask[],
  goals: Goal[],
  bottleneck?: Bottleneck,
): string {
  if (!plan) return 'Generate today’s plan to see how your time lines up with your goals.';
  const tasks = plan.blocks.filter((b) => b.type === 'task');
  if (!tasks.length) return 'Nothing is scheduled yet. Add a few tasks linked to your goals, then generate the plan.';
  const total = tasks.reduce((s, b) => s + (b.end - b.start), 0);
  const byGoal: Record<string, number> = {};
  for (const b of tasks) byGoal[b.goalIds[0] ?? '_'] = (byGoal[b.goalIds[0] ?? '_'] ?? 0) + (b.end - b.start);
  const [topGoalId, topMin] = Object.entries(byGoal).sort((a, b) => b[1] - a[1])[0];
  const topGoal = goals.find((g) => g.id === topGoalId);
  const bnMin = bottleneck
    ? tasks.filter((b) => b.goalIds.some((g) => bottleneck.goalIds.includes(g))).reduce((s, b) => s + (b.end - b.start), 0)
    : 0;
  const bnTasks = tasks.filter((b) => ranked.find((r) => r.task.id === b.taskId)?.task.removesBottleneck);
  const parts: string[] = [];
  parts.push(
    `${fmtDuration(total)} of focused work, led by ${topGoal?.name ?? 'unlinked work'} (${fmtDuration(topMin)}).`,
  );
  if (bottleneck?.statement && bnMin > 0)
    parts.push(
      `${Math.round((bnMin / total) * 100)}% of it goes at your bottleneck — “${bottleneck.statement}”${
        bnTasks.length ? `, including ${bnTasks.length} task${bnTasks.length > 1 ? 's' : ''} aimed straight at it` : ''
      }.`,
    );
  else if (bottleneck?.statement) parts.push(`Nothing today touches your bottleneck (“${bottleneck.statement}”). Is that deliberate?`);
  parts.push(`${fmtDuration(plan.stats.slackMin)} stays open for recovery and the unexpected.`);
  return parts.join(' ');
}
