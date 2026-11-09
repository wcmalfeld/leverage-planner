/**
 * Strategy advisor: bottleneck detection and "What am I missing?" suggestions.
 *
 * The `StrategyAdvisor` interface is the integration point for a future AI coach.
 * The MVP ships a deterministic rule-based implementation that needs no network.
 * An AI implementation would receive the same AppData snapshot (only after the user
 * explicitly configures a provider and consents) and return the same shape.
 */
import type { AppData, Goal, ISODate, Task } from '../domain/types';
import { addDays } from '../domain/time';
import { goalWeight, isOpen } from './scoring';
import { minutesByGoal } from './review';
import { driftAlerts, stalledGoals } from './alignment';

export interface Suggestion {
  id: string;
  kind: 'new-task' | 'clarify' | 'breakdown' | 'neglected' | 'milestone' | 'bottleneck';
  title: string;
  detail: string;
  goalId?: string;
  taskId?: string;
  /** Draft task the user can accept with one click. */
  draft?: Partial<Task>;
}

export interface StrategyAdvisor {
  readonly name: string;
  suggest(data: AppData, today: ISODate): Promise<Suggestion[]>;
}

export interface BottleneckCandidate {
  goal: Goal;
  score: number;
  reasons: string[];
}

/**
 * Heuristic: the constraint whose removal unlocks the most is usually an
 * important goal that is (a) far from its target, (b) neglected recently, and
 * (c) holding up other work through blocked or repeatedly postponed tasks.
 */
export function detectBottleneck(data: AppData, today: ISODate): BottleneckCandidate[] {
  const mins = minutesByGoal(data.actuals, data.tasks, addDays(today, -14), today);
  const open = data.tasks.filter(isOpen);
  return data.goals
    .filter((g) => g.status === 'active' && !g.sustaining)
    .map((goal) => {
      const reasons: string[] = [];
      const w = goalWeight(goal, data.goals);
      let gap = 0.6;
      if (goal.metric && goal.metric.target > 0) {
        const p = Math.min(1, goal.metric.current / goal.metric.target);
        gap = 1 - p;
        reasons.push(`${Math.round(p * 100)}% of the way to ${goal.metric.target} ${goal.metric.unit ?? goal.metric.label}`);
      }
      const recent = mins[goal.id] ?? 0;
      const neglect = recent === 0 ? 1 : recent < 120 ? 0.7 : 0.35;
      if (recent < 120) reasons.push(recent === 0 ? 'no time logged in 14 days' : `only ${recent} min in 14 days`);
      const goalTasks = open.filter((t) => t.goalIds.includes(goal.id));
      const stuck = goalTasks.filter((t) => t.postponeCount >= 2).length;
      const blocking = open.filter((t) =>
        t.dependsOn.some((d) => goalTasks.some((gt) => gt.id === d)) && !t.goalIds.includes(goal.id),
      ).length;
      if (stuck) reasons.push(`${stuck} task${stuck > 1 ? 's' : ''} repeatedly postponed`);
      if (blocking) reasons.push(`holds up ${blocking} task${blocking > 1 ? 's' : ''} in other goals`);
      if (!goalTasks.length) reasons.push('no next actions defined');
      const score = w * (0.5 * gap + 0.3 * neglect + 0.1 * Math.min(stuck, 3) + 0.15 * Math.min(blocking, 3) + (goalTasks.length ? 0 : 0.15));
      return { goal, score, reasons };
    })
    .sort((a, b) => b.score - a.score);
}

const TEMPLATES: { match: RegExp; tasks: Partial<Task>[] }[] = [
  {
    match: /financ|money|income|savings/i,
    tasks: [
      { title: 'List every monthly obligation and its due date', expectedResult: 'One-page cash-flow snapshot', durationMin: 45, impact: 4, compounding: 3, confidence: 5, energy: 'medium' },
      { title: 'Set up an automatic transfer to savings', expectedResult: 'Recurring transfer live', durationMin: 20, impact: 3, compounding: 5, confidence: 5, energy: 'low' },
    ],
  },
  {
    match: /career|job|work/i,
    tasks: [
      { title: 'Message two people at a target company for a 20-minute chat', expectedResult: 'Two messages sent; at least one call booked', durationMin: 40, impact: 5, compounding: 4, confidence: 3, energy: 'high' },
      { title: 'Tailor résumé to the single best-fit open role', expectedResult: 'Application submitted', durationMin: 75, impact: 4, compounding: 2, confidence: 3, energy: 'medium' },
    ],
  },
  {
    match: /tutor|client|business|mathlete/i,
    tasks: [
      { title: 'Ask three past contacts for one tutoring referral each', expectedResult: 'Three asks sent; referrals tracked', durationMin: 30, impact: 5, compounding: 4, confidence: 3, energy: 'medium' },
      { title: 'Publish one short example lesson to the website', expectedResult: 'Page live with a booking link', durationMin: 90, impact: 3, compounding: 5, confidence: 4, energy: 'high' },
    ],
  },
  {
    match: /skill|portfolio|technical|engineer|software|ai/i,
    tasks: [
      { title: 'Ship one small, visible improvement to a portfolio project', expectedResult: 'Commit pushed + README updated', durationMin: 90, impact: 3, compounding: 5, confidence: 4, energy: 'high', splittable: true },
    ],
  },
  {
    match: /health|fitness|athlet|bike|ride/i,
    tasks: [{ title: 'Plan next week’s rides and strength sessions', expectedResult: 'Sessions on the calendar', durationMin: 15, impact: 3, compounding: 4, confidence: 5, energy: 'low' }],
  },
  {
    match: /relationship|friend|community|people/i,
    tasks: [
      { title: 'Invite a friend to ride or grab food this week', expectedResult: 'Plan confirmed', durationMin: 10, impact: 3, compounding: 5, confidence: 4, energy: 'low' },
      { title: 'Find one recurring local group to join', expectedResult: 'Attended once', durationMin: 30, impact: 3, compounding: 5, confidence: 3, energy: 'low' },
    ],
  },
];

/** Starter task ideas for a goal, matched on its name and outcome. */
export function templateDrafts(goalText: string): Partial<Task>[] {
  return TEMPLATES.find((t) => t.match.test(goalText))?.tasks ?? [];
}

export class RuleBasedAdvisor implements StrategyAdvisor {
  readonly name = 'Built-in rules (offline)';

  async suggest(data: AppData, today: ISODate): Promise<Suggestion[]> {
    return ruleSuggestions(data, today);
  }
}

export function ruleSuggestions(data: AppData, today: ISODate): Suggestion[] {
  const out: Suggestion[] = [];
  const open = data.tasks.filter(isOpen);
  const mins = minutesByGoal(data.actuals, data.tasks, addDays(today, -7), today);
  const existingTitles = new Set(data.tasks.map((t) => t.title.toLowerCase()));

  const [bn] = detectBottleneck(data, today);
  if (bn && !data.bottleneck.goalIds.includes(bn.goal.id) && bn.score > 0.4)
    out.push({
      id: `bn_${bn.goal.id}`,
      kind: 'bottleneck',
      title: `Is ${bn.goal.name} your real bottleneck?`,
      detail: bn.reasons.join('; ') || 'Important goal with little momentum.',
      goalId: bn.goal.id,
    });

  for (const d of driftAlerts(data, today))
    out.push({
      id: `drift_${d.goal.id}`,
      kind: 'neglected',
      title: `${d.goal.name} is under its target two weeks running`,
      detail: `It got ${Math.round(d.shares[0] * 100)}% then ${Math.round(d.shares[1] * 100)}% of your goal time against a ${Math.round(d.target * 100)}% target. Protect a block for it early this week, or lower the target if priorities changed.`,
      goalId: d.goal.id,
    });
  const stalls = new Map(stalledGoals(data, today).map((s) => [s.goal.id, s]));

  for (const g of data.goals.filter((g) => g.status === 'active').sort((a, b) => a.order - b.order)) {
    const gTasks = open.filter((t) => t.goalIds.includes(g.id));
    const stall = stalls.get(g.id);
    if (stall?.reason === 'no-next-action')
      out.push({ id: `none_${g.id}`, kind: 'neglected', title: `${g.name} has no next action`, detail: 'A goal without a next action can’t be scheduled. Add one concrete step.', goalId: g.id });
    else if (stall?.reason === 'no-progress')
      out.push({ id: `idle_${g.id}`, kind: 'neglected', title: `${g.name} has stalled`, detail: 'Nothing logged or finished for it in 14 days. Schedule its best task, or pause the goal if it’s not a priority right now.', goalId: g.id, taskId: stall.topTaskId });
    else if (!mins[g.id] && g.importance >= 4 && !g.sustaining && !stall)
      out.push({ id: `idle_${g.id}`, kind: 'neglected', title: `No time on ${g.name} this week`, detail: `It’s rated ${g.importance}/5 but nothing was logged in 7 days.`, goalId: g.id });

    for (const m of g.milestones.filter((m) => !m.done).slice(0, 1))
      if (!gTasks.some((t) => t.title.toLowerCase().includes(m.title.toLowerCase().slice(0, 12))))
        out.push({
          id: `ms_${m.id}`,
          kind: 'milestone',
          title: `Next step for milestone “${m.title}”`,
          detail: 'No task currently points at this milestone.',
          goalId: g.id,
          draft: { title: `First step toward: ${m.title}`, goalIds: [g.id], impact: 4, durationMin: 45 },
        });

    const tmpl = TEMPLATES.find((t) => t.match.test(g.name + ' ' + g.outcome));
    for (const d of tmpl?.tasks ?? []) {
      if (existingTitles.has(d.title!.toLowerCase())) continue;
      out.push({ id: `tpl_${g.id}_${d.title}`, kind: 'new-task', title: d.title!, detail: `Often high-leverage for ${g.name}: ${d.expectedResult}.`, goalId: g.id, draft: { ...d, goalIds: [g.id] } });
      break; // one per goal keeps the list short
    }
  }

  for (const t of open.filter((t) => !t.expectedResult && !t.parentId).slice(0, 3))
    out.push({ id: `cl_${t.id}`, kind: 'clarify', title: `Clarify “${t.title}”`, detail: 'No “done” definition yet — turn it into a concrete next action.', taskId: t.id });
  for (const t of open.filter((t) => t.postponeCount >= 3).slice(0, 2))
    out.push({ id: `bd_${t.id}`, kind: 'breakdown', title: `Break down “${t.title}”`, detail: `Postponed ${t.postponeCount}×. A 25-minute first step usually gets it moving.`, taskId: t.id });

  return out;
}
