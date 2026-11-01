/**
 * Plain-text snapshot of the user's planner for the AI coach. Pure and
 * deterministic, so the same data always produces the same prompt (and the same
 * prompt-cache prefix). IDs are included so the coach can point at goals and tasks.
 */
import type { AppData, ISODate } from '../domain/types';
import { addDays, DAY_NAMES, fmtDateLong, fmtDuration, fmtTime } from '../domain/time';
import { rankTasks } from '../engine/scoring';
import { minutesByGoal, recentGoalMinutes } from '../engine/review';

const MAX_TASKS = 40;

export function coachContext(data: AppData, today: ISODate): string {
  const s = data.settings;
  const goals = [...data.goals].sort((a, b) => a.order - b.order);
  const goalName = (id: string) => data.goals.find((g) => g.id === id)?.name ?? 'Unassigned';
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
  const ranked = rankTasks(data.tasks, s.weights, {
    today,
    goals: data.goals,
    bottleneck: data.bottleneck.statement ? data.bottleneck : undefined,
    tasksById,
    recentGoalMinutes: recentGoalMinutes(data.actuals, data.tasks, today),
  });
  const L: string[] = [];

  L.push(`Today is ${fmtDateLong(today)} (${today}).`);
  L.push(
    `Day shape: wake ${fmtTime(s.wake)}, bedtime ${fmtTime(s.sleep)}; best focus ${s.focusWindows.map((w) => `${fmtTime(w.start)}–${fmtTime(w.end)}`).join(', ') || 'not set'}; daily focused-work cap ${fmtDuration(s.maxWorkMin)}; wants ${fmtDuration(s.unscheduledMin)} unscheduled.`,
  );

  L.push('', '## Goals (priority order)');
  for (const g of goals) {
    L.push(`- [goal:${g.id}] ${g.name} — ${g.status}, importance ${g.importance}/5, ${g.horizon}${g.sustaining ? ', sustaining (protect, don’t maximise)' : ''}`);
    if (g.outcome) L.push(`  Outcome: ${g.outcome}`);
    if (g.why) L.push(`  Why: ${g.why}`);
    if (g.metric) L.push(`  Metric: ${g.metric.label} ${g.metric.current}/${g.metric.target}${g.metric.unit ? ` ${g.metric.unit}` : ''}`);
    if (g.targetDate) L.push(`  Target date: ${g.targetDate}`);
    const open = g.milestones.filter((m) => !m.done);
    if (open.length) L.push(`  Open milestones: ${open.map((m) => `${m.title}${m.dueDate ? ` (due ${m.dueDate})` : ''}`).join('; ')}`);
  }

  L.push('', '## Stated bottleneck');
  L.push(data.bottleneck.statement ? `${data.bottleneck.statement} (goals: ${data.bottleneck.goalIds.map(goalName).join(', ') || 'none linked'})` : 'Not set.');

  L.push('', `## Open tasks, ranked by the planner’s leverage score (top ${MAX_TASKS})`);
  if (!ranked.length) L.push('None.');
  for (const { task: t, result: r, rank } of ranked.slice(0, MAX_TASKS)) {
    const bits = [
      `score ${Math.round(r.score)}`,
      t.status,
      t.goalIds.length ? t.goalIds.map(goalName).join(' + ') : 'no goal',
      t.durationMin ? fmtDuration(t.durationMin) : 'no estimate',
      t.deadline && `due ${t.deadline}`,
      t.postponeCount >= 2 && `postponed ${t.postponeCount}×`,
      r.blocked && 'blocked by unfinished prerequisites',
      t.recurrence !== 'none' && t.recurrence,
    ].filter(Boolean);
    L.push(`${rank}. [task:${t.id}] ${t.title} — ${bits.join(', ')}`);
    if (t.expectedResult) L.push(`   Done means: ${t.expectedResult}`);
  }

  const done = data.tasks.filter((t) => t.status === 'completed' && t.completedAt && t.completedAt >= addDays(today, -14));
  if (done.length) {
    L.push('', '## Completed in the last 14 days');
    for (const t of done) L.push(`- ${t.title} (${goalName(t.goalIds[0] ?? '')})${t.outcome ? ` — ${t.outcome}` : ''}`);
  }

  L.push('', '## Time logged by goal, last 14 days');
  const mins = minutesByGoal(data.actuals, data.tasks, addDays(today, -14), today);
  const logged = Object.entries(mins).sort((a, b) => b[1] - a[1]);
  L.push(logged.length ? logged.map(([id, m]) => `- ${id === '_none' ? 'Unassigned' : goalName(id)}: ${fmtDuration(m)}`).join('\n') : 'Nothing logged.');

  L.push('', '## Recurring and upcoming commitments');
  const commitments = data.commitments.filter((c) => !c.date || (c.date >= today && c.date <= addDays(today, 7)));
  if (!commitments.length) L.push('None.');
  for (const c of commitments) {
    const when = c.date ?? c.days.map((d) => DAY_NAMES[d]).join('/');
    L.push(`- ${c.title}: ${when} ${fmtTime(c.start)}–${fmtTime(c.end)} (${c.kind}${c.fixed ? ', fixed' : ', flexible'}${c.essential ? ', protected' : ''})`);
  }

  const plan = data.plans[today];
  if (plan) {
    L.push('', '## Today’s generated plan');
    for (const b of plan.blocks.filter((b) => b.type === 'task' || b.type === 'commitment'))
      L.push(`- ${fmtTime(b.start)}–${fmtTime(b.end)} ${b.title}${b.status !== 'proposed' ? ` (${b.status})` : ''}`);
    for (const u of plan.unscheduled.filter((u) => u.important))
      L.push(`- Did not fit: ${tasksById.get(u.taskId)?.title ?? u.taskId} — ${u.reason}`);
  }

  const reviews = Object.values(data.dailyReviews).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3);
  const weekly = Object.values(data.weeklyReviews).sort((a, b) => b.weekStart.localeCompare(a.weekStart))[0];
  if (reviews.length || weekly) {
    L.push('', '## Recent reviews');
    for (const r of reviews) {
      const notes = [r.outcomes && `outcomes: ${r.outcomes}`, r.obstacles && `obstacles: ${r.obstacles}`, r.changes && `changes: ${r.changes}`, r.energy && `energy ${r.energy}/5`].filter(Boolean);
      L.push(`- ${r.date}: ${notes.join('; ') || 'no notes'}`);
    }
    if (weekly) L.push(`- Week of ${weekly.weekStart}: ${weekly.notes || 'no notes'}${weekly.nextWeekFocus ? `; next focus: ${weekly.nextWeekFocus}` : ''}`);
  }

  return L.join('\n');
}
