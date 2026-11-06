/**
 * Starting data: the default goal set (editable), a sensible routine, and an
 * optional demo with realistic tasks, a current plan and a week of history.
 */
import type { ActualEntry, AppData, Commitment, CurrentBlock, Goal, ISODate, Settings, Task } from '../domain/types';
import { addDays } from '../domain/time';
import { DEFAULT_WEIGHTS } from '../engine/scoring';

const H = (h: number, m = 0) => h * 60 + m;
const ALL = [0, 1, 2, 3, 4, 5, 6];
const WEEKDAYS = [1, 2, 3, 4, 5];

export const GOAL_COLORS = ['teal', 'blue', 'amber', 'violet', 'green', 'rose', 'sky', 'slate'] as const;

export function defaultSettings(): Settings {
  return {
    wake: H(6, 30),
    sleep: H(22, 30),
    focusWindows: [{ start: H(8), end: H(11, 30) }],
    energy: [
      { start: H(6, 30), end: H(12), level: 'high' },
      { start: H(12), end: H(15), level: 'medium' },
      { start: H(15), end: H(18), level: 'medium' },
      { start: H(18), end: H(22, 30), level: 'low' },
    ],
    bufferMin: 10,
    breakAfterMin: 90,
    breakMin: 15,
    unscheduledMin: 60,
    maxBlockMin: 120,
    maxWorkMin: 360,
    defaultDurationMin: 30,
    homeLocation: 'home',
    leverageBar: 45,
    shutdown: { enabled: true, at: H(17, 30), durationMin: 15 },
    nudges: { enabled: true, leadMin: 1 },
    weights: { ...DEFAULT_WEIGHTS },
  };
}

export function defaultGoals(today: ISODate): Goal[] {
  const g = (
    id: string,
    order: number,
    name: string,
    outcome: string,
    why: string,
    importance: Goal['importance'],
    extra: Partial<Goal> = {},
  ): Goal => ({
    id,
    order,
    name,
    outcome,
    why,
    importance,
    horizon: 'annual',
    status: 'active',
    color: GOAL_COLORS[order % GOAL_COLORS.length],
    milestones: [],
    ...extra,
  });
  return [
    g('g_fin', 0, 'Financial stability', 'Reliable monthly income covering obligations, a 3-month emergency fund, then steady saving.', 'Removes the background stress and buys the freedom to choose good opportunities.', 5, {
      metric: { label: 'Emergency fund', current: 0, target: 3, unit: 'months' },
      targetDate: addDays(today, 365),
    }),
    g('g_career', 1, 'Career', 'Work with strong earning potential, real learning and flexibility.', 'Income, skills and network all compound from the right role.', 5, {
      horizon: 'quarter',
      targetDate: addDays(today, 90),
    }),
    g('g_mathlete', 2, 'Mathlete MTB', 'A math tutoring + MTB education business with steady paying clients, then scalable products.', 'Own something that combines what I’m good at with what I love.', 4, {
      metric: { label: 'Paying clients', current: 2, target: 8, unit: 'clients' },
    }),
    g('g_tech', 3, 'Technical skills & portfolio', 'Strong software engineering + AI skills, proven by shipped projects.', 'Raises earning potential and makes every other path easier.', 4),
    g('g_health', 4, 'Health & riding', 'Fit, healthy, riding well and progressing on the bike.', 'Everything runs on energy. Riding is also the joy.', 4, { sustaining: true }),
    g('g_people', 5, 'Relationships & community', 'Close friendships, meaningful relationships and roots where I live.', 'A good life is shared.', 4, { sustaining: true }),
    g('g_freedom', 6, 'Freedom & adventure', 'Financial, professional and personal room to travel, ride and explore.', 'The point of building all the rest.', 3, { horizon: 'vision' }),
  ];
}

export function defaultCommitments(): Commitment[] {
  const c = (p: Partial<Commitment> & Pick<Commitment, 'id' | 'title' | 'start' | 'end' | 'kind'>): Commitment => ({
    days: ALL,
    fixed: false,
    essential: true,
    ...p,
  });
  return [
    c({ id: 'c_morning', title: 'Morning routine + breakfast', kind: 'routine', start: H(6, 30), end: H(7, 15) }),
    c({ id: 'c_lunch', title: 'Lunch', kind: 'meal', start: H(12, 15), end: H(13) }),
    c({ id: 'c_dinner', title: 'Dinner', kind: 'meal', start: H(18, 45), end: H(19, 30) }),
    c({ id: 'c_wind', title: 'Wind down', kind: 'rest', start: H(21, 45), end: H(22, 30) }),
  ];
}

export function emptyData(today: ISODate): AppData {
  return {
    version: 1,
    onboarded: false,
    goals: defaultGoals(today),
    bottleneck: { statement: '', goalIds: [], updatedAt: today, history: [] },
    tasks: [],
    commitments: defaultCommitments(),
    currentPlan: [],
    actuals: [],
    plans: {},
    dailyReviews: {},
    weeklyReviews: {},
    settings: defaultSettings(),
  };
}

export function demoData(today: ISODate): AppData {
  const base = emptyData(today);
  const d = (n: number) => addDays(today, n);
  const t = (p: Partial<Task> & Pick<Task, 'id' | 'title'>): Task => ({
    goalIds: [],
    dependsOn: [],
    recurrence: 'none',
    status: 'ready',
    createdAt: d(-6),
    postponeCount: 0,
    ...p,
  });

  const tasks: Task[] = [
    t({ id: 't_reach', title: 'Message two engineers at a target company for 20-min chats', goalIds: ['g_career'], expectedResult: 'Two personal messages sent; aim for one call booked this week', durationMin: 40, impact: 5, compounding: 5, confidence: 3, energy: 'high', removesBottleneck: true, postponeCount: 2 }),
    t({ id: 't_apply', title: 'Apply to the best-fit AI engineering role', goalIds: ['g_career', 'g_fin'], expectedResult: 'Application submitted with a tailored résumé and short note', durationMin: 75, deadline: d(2), impact: 5, compounding: 2, confidence: 2, energy: 'high', dependsOn: ['t_resume'] }),
    t({ id: 't_resume', title: 'Tailor résumé bullets to AI engineering roles', goalIds: ['g_career'], expectedResult: 'Résumé v2 with three quantified project bullets', durationMin: 45, impact: 4, compounding: 4, confidence: 4, energy: 'medium' }),
    t({ id: 't_leads', title: 'Follow up with 3 tutoring leads', goalIds: ['g_mathlete', 'g_fin'], expectedResult: 'Three follow-ups sent; trial sessions offered', durationMin: 30, impact: 4, compounding: 3, confidence: 4, energy: 'medium', removesBottleneck: true }),
    t({ id: 't_booking', title: 'Build booking + payment page for Mathlete MTB site', goalIds: ['g_mathlete'], expectedResult: 'Visitors can book and pay for a session without emailing me', durationMin: 150, impact: 4, compounding: 5, confidence: 4, energy: 'high', splittable: true }),
    t({ id: 't_prep', title: 'Prep algebra review for Tuesday client', goalIds: ['g_mathlete'], expectedResult: 'Worksheet + 3 worked examples ready', durationMin: 30, deadline: d(3), impact: 3, compounding: 2, confidence: 5, energy: 'low' }),
    t({ id: 't_scope', title: 'Define scope for the RAG portfolio project', goalIds: ['g_tech'], expectedResult: 'One-page spec: user, data, demo script, done criteria', durationMin: 30, impact: 3, compounding: 4, confidence: 5, energy: 'medium' }),
    t({ id: 't_rag', title: 'Ship retrieval demo for portfolio project', goalIds: ['g_tech', 'g_career'], expectedResult: 'Deployed demo + README with a 60-second walkthrough', durationMin: 180, impact: 4, compounding: 5, confidence: 3, energy: 'high', splittable: true, dependsOn: ['t_scope'] }),
    t({ id: 't_budget', title: 'Update budget and list every obligation', goalIds: ['g_fin'], expectedResult: 'One-page cash-flow: income, fixed costs, due dates, gap', durationMin: 45, deadline: d(4), impact: 4, compounding: 3, confidence: 5, energy: 'medium' }),
    t({ id: 't_mobility', title: 'Mobility + core', goalIds: ['g_health'], expectedResult: '20 minutes, done', durationMin: 20, recurrence: 'daily', impact: 3, compounding: 4, confidence: 5, energy: 'low' }),
    t({ id: 't_ride', title: 'Invite Sam and Priya to a Sunday ride', goalIds: ['g_people', 'g_health'], expectedResult: 'Ride confirmed with time + trailhead', durationMin: 10, impact: 3, compounding: 5, confidence: 4, energy: 'low' }),
    t({ id: 't_part', title: 'Return wrong brake pads to the bike shop', goalIds: ['g_health'], expectedResult: 'Refund or exchange done', durationMin: 30, deadline: d(1), impact: 2, compounding: 1, confidence: 5, energy: 'low', location: 'town' }),
    t({ id: 't_reg', title: 'Renew car registration', goalIds: ['g_fin'], expectedResult: 'Renewal confirmation saved', durationMin: 20, deadline: d(5), impact: 2, compounding: 1, confidence: 5, energy: 'low' }),
    t({ id: 't_moab', title: 'Research a spring Moab trip', goalIds: ['g_freedom'], durationMin: 45, impact: 2, compounding: 2, confidence: 4, energy: 'low' }),
    t({ id: 't_course', title: 'Watch the next React course module', goalIds: ['g_tech'], durationMin: 60, impact: 2, compounding: 2, confidence: 5, energy: 'low', postponeCount: 1 }),
    t({ id: 't_notes', title: 'Reorganize bookmarks and notes app', durationMin: 60, impact: 2, compounding: 1, confidence: 5, energy: 'low' }),
    t({ id: 't_vague', title: 'Get a better job', goalIds: ['g_career'], status: 'inbox' }),
    t({ id: 't_done1', title: 'Draft Mathlete MTB one-pager', goalIds: ['g_mathlete'], status: 'completed', completedAt: d(-3), durationMin: 60, actualMin: 75, impact: 4, outcome: 'Sent to two parents; one asked for pricing' }),
    t({ id: 't_done2', title: 'Refactor portfolio site nav', goalIds: ['g_tech'], status: 'completed', completedAt: d(-2), durationMin: 60, actualMin: 120, impact: 2 }),
  ];

  const commitments: Commitment[] = [
    ...base.commitments,
    { id: 'c_tutor', title: 'Tutoring session', kind: 'work', days: [2, 4], start: H(16), end: H(17), fixed: true, essential: false, goalId: 'g_mathlete', location: 'town', travelBeforeMin: 20, travelAfterMin: 20 },
    { id: 'c_ride', title: 'Trail ride', kind: 'exercise', days: [1, 3, 6], start: H(16, 30), end: H(18, 15), fixed: false, essential: true, goalId: 'g_health' },
    { id: 'c_shift', title: 'Bike shop shift', kind: 'work', days: [5], start: H(9), end: H(15), fixed: true, essential: false, goalId: 'g_fin', location: 'town', travelBeforeMin: 15, travelAfterMin: 15 },
    { id: 'c_friends', title: 'Dinner with friends', kind: 'social', days: [0], start: H(18, 30), end: H(20, 30), fixed: false, essential: true, goalId: 'g_people' },
  ];
  // Dinner-with-friends replaces the default Sunday dinner.
  commitments.find((c) => c.id === 'c_dinner')!.days = [1, 2, 3, 4, 5, 6];

  const currentPlan: CurrentBlock[] = [
    { id: 'cp_phone', title: 'Phone, news, socials', days: ALL, start: H(7, 15), end: H(8, 15), value: 'distraction' },
    { id: 'cp_email', title: 'Email + job-board browsing', days: WEEKDAYS, start: H(8, 15), end: H(9, 30), goalId: 'g_career', value: 'low' },
    { id: 'cp_portfolio', title: 'Portfolio tinkering', days: [1, 2, 3, 4, 6], start: H(9, 30), end: H(12), goalId: 'g_tech' },
    { id: 'cp_course', title: 'React course', days: [1, 3], start: H(13, 30), end: H(15), taskId: 't_course' },
    { id: 'cp_errands', title: 'Errands', days: [0, 6], start: H(13, 30), end: H(15) },
    { id: 'cp_prep', title: 'Lesson prep', days: [2, 4], start: H(14), end: H(15), goalId: 'g_mathlete' },
    { id: 'cp_yt', title: 'YouTube / Reddit', days: ALL, start: H(20), end: H(21, 30), value: 'distraction' },
  ];

  const actuals: ActualEntry[] = [];
  const log = (n: number, title: string, minutes: number, p: Partial<ActualEntry> = {}) =>
    actuals.push({ id: `a_${n}_${title.slice(0, 6)}_${actuals.length}`, date: d(n), title, minutes, ...p });
  for (let n = -7; n <= -1; n++) {
    log(n, 'Portfolio tinkering', 150, { goalId: 'g_tech' });
    log(n, 'Phone, news, socials', 70, { distraction: true });
    if (n % 2) log(n, 'YouTube / Reddit', 80, { distraction: true });
    if (n === -3) log(n, 'Draft Mathlete MTB one-pager', 75, { taskId: 't_done1' });
    if (n === -2) log(n, 'Refactor portfolio site nav', 120, { taskId: 't_done2' });
    if (n === -5 || n === -2) log(n, 'Trail ride', 105, { goalId: 'g_health' });
    if (n === -4) log(n, 'Job-board browsing', 60, { goalId: 'g_career' });
    if (n === -1) log(n, 'Mobility + core', 20, { taskId: 't_mobility' });
  }

  return {
    ...base,
    onboarded: true,
    tasks,
    commitments,
    currentPlan,
    actuals,
    bottleneck: {
      statement: 'No reliable income yet — financial pressure limits every other choice',
      goalIds: ['g_fin', 'g_career', 'g_mathlete'],
      updatedAt: d(-6),
      history: [{ date: d(-6), statement: 'No reliable income yet — financial pressure limits every other choice' }],
    },
    goals: base.goals.map((g) =>
      g.id === 'g_mathlete'
        ? {
            ...g,
            milestones: [
              { id: 'm1', title: 'Online booking live', horizon: 'quarter', dueDate: d(30), done: false },
              { id: 'm2', title: '5 paying clients', horizon: 'quarter', dueDate: d(75), done: false },
            ],
          }
        : g.id === 'g_career'
          ? { ...g, milestones: [{ id: 'm3', title: '10 informational conversations', horizon: 'quarter', dueDate: d(45), done: false }] }
          : g,
    ),
    dailyReviews: {
      [d(-1)]: {
        date: d(-1),
        completedTaskIds: ['t_mobility'],
        missedTaskIds: ['t_reach'],
        outcomes: 'Kept the morning ride habit.',
        obstacles: 'Lost the morning to my phone; reach-outs felt awkward so I kept tinkering instead.',
        changes: '',
        savedAt: new Date().toISOString(),
      },
    },
  };
}
