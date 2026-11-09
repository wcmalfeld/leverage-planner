/**
 * All user-facing mutations live here, so views stay declarative and every
 * change goes through one persistence path.
 */
import type {
  ActualEntry,
  AppData,
  Block,
  Commitment,
  CurrentBlock,
  DailyReview,
  Goal,
  ISODate,
  Milestone,
  Rating,
  Task,
  WeeklyReview,
} from '../domain/types';
import { addDays, todayISO, uid } from '../domain/time';
import { GOAL_COLORS } from './seed';
import { store, update } from './store';
import { buildPlan } from './derived';

// ───────── Tasks ─────────

export function addTask(p: Partial<Task> & { title: string }): string {
  const id = uid('t');
  update((d) => {
    d.tasks.unshift({
      id,
      goalIds: [],
      dependsOn: [],
      recurrence: 'none',
      status: p.goalIds?.length || p.expectedResult ? 'ready' : 'inbox',
      createdAt: todayISO(),
      postponeCount: 0,
      ...p,
      title: p.title.trim(),
    });
  });
  return id;
}

export function updateTask(id: string, patch: Partial<Task>) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    if (t.status === 'inbox' && (t.goalIds.length || t.expectedResult) && patch.status === undefined) t.status = 'ready';
  });
}

export function deleteTask(id: string) {
  update((d) => {
    d.tasks = d.tasks.filter((t) => t.id !== id);
    for (const t of d.tasks) t.dependsOn = t.dependsOn.filter((x) => x !== id);
    for (const p of Object.values(d.plans)) p.blocks = p.blocks.filter((b) => b.taskId !== id);
  });
}

/** Record completion: status, actual time, outcome, and a time-log entry. */
export function completeTask(id: string, date: ISODate, actualMin: number | undefined, outcome?: string) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    if (t.recurrence !== 'none') {
      t.lastDoneOn = date;
    } else {
      t.status = 'completed';
      t.completedAt = date;
    }
    if (actualMin) t.actualMin = actualMin;
    if (outcome) t.outcome = outcome;
    t.resumeNote = undefined;
    t.plannedFor = undefined;
    d.actuals = d.actuals.filter((a) => !(a.date === date && a.taskId === id));
    if (actualMin) d.actuals.push({ id: uid('a'), date, title: t.title, minutes: actualMin, taskId: id });
    const plan = d.plans[date];
    if (plan) for (const b of plan.blocks) if (b.taskId === id) b.status = 'done';
  });
}

export function reopenTask(id: string) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    t.status = 'ready';
    t.completedAt = undefined;
    t.lastDoneOn = undefined;
  });
}

/** Turn a vague idea into a concrete next action. The original is parked, not lost. */
export function clarifyTask(id: string, next: Partial<Task> & { title: string }) {
  const parent = store.get().tasks.find((t) => t.id === id);
  const childId = addTask({ goalIds: parent?.goalIds ?? [], ...next, parentId: id, status: 'ready' });
  update((d) => {
    const p = d.tasks.find((t) => t.id === id);
    if (p) {
      p.status = 'deferred';
      p.notes = `${p.notes ? p.notes + '\n' : ''}Clarified into “${next.title}”.`;
    }
  });
  return childId;
}

/**
 * "Ready to resume" (Leroy & Glomb 2018): a line on where you stopped and what's next
 * lets you set the task down cleanly, and is shown the next time it comes up.
 */
export function pauseTask(id: string, date: ISODate, note: string, minutes: number) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    t.resumeNote = note.trim() ? { text: note.trim(), date } : t.resumeNote;
    if (minutes > 0) d.actuals.push({ id: uid('a'), date, title: t.title, minutes, taskId: id });
  });
}

/** Commit a task to a day (it gets priority there) and refresh that day's plan if one exists. */
export function commitTo(id: string, date: ISODate) {
  updateTask(id, { plannedFor: date, snoozedUntil: undefined });
  if (store.get().plans[date]) generateFor(date);
}

// ───────── Triage ─────────

export type TriageDecision = 'keep' | 'snooze' | 'someday' | 'drop';

export function triageTask(id: string, decision: TriageDecision, today = todayISO()) {
  if (decision === 'drop') return deleteTask(id);
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    if (decision === 'keep') t.keepBelowBar = true;
    if (decision === 'snooze') t.snoozedUntil = addDays(today, 7);
    if (decision === 'someday') t.status = 'deferred';
  });
}

export function undoTriage(id: string) {
  update((d) => {
    const t = d.tasks.find((x) => x.id === id);
    if (!t) return;
    t.keepBelowBar = undefined;
    t.snoozedUntil = undefined;
    if (t.status === 'deferred') t.status = 'ready';
  });
}

export function setLeverageBar(bar: number) {
  update((d) => {
    d.settings.leverageBar = Math.max(0, Math.min(100, Math.round(bar)));
  });
}

// ───────── Time log ─────────

export function logActual(e: Omit<ActualEntry, 'id'>) {
  update((d) => {
    d.actuals.push({ ...e, id: uid('a') });
  });
}
export function deleteActual(id: string) {
  update((d) => {
    d.actuals = d.actuals.filter((a) => a.id !== id);
  });
}

// ───────── Plans & blocks ─────────

export function generateFor(date: ISODate, keepLocked = true) {
  const data = store.get();
  const prev = data.plans[date];
  const previous = keepLocked ? prev : prev ? { ...prev, blocks: prev.blocks.filter((b) => b.status === 'done'), rejectedTaskIds: [] } : undefined;
  store.savePlan(buildPlan(data, date, previous));
}

function editBlock(date: ISODate, blockId: string, fn: (b: Block, all: Block[]) => void) {
  update((d) => {
    const plan = d.plans[date];
    if (!plan) return;
    const b = plan.blocks.find((x) => x.id === blockId);
    if (b) fn(b, plan.blocks);
    plan.blocks.sort((a, z) => a.start - z.start);
  });
}

/** Move or resize — the block becomes locked so regeneration keeps it. */
export function setBlockTime(date: ISODate, blockId: string, start: number, end: number) {
  editBlock(date, blockId, (b, all) => {
    b.start = start;
    b.end = end;
    b.locked = true;
    if (b.status === 'proposed') b.status = 'accepted';
    // Buffers next to an edited block are stale; drop any it now overlaps.
    for (let i = all.length - 1; i >= 0; i--) {
      const x = all[i];
      if ((x.type === 'buffer' || x.type === 'break') && x.start < end && start < x.end) all.splice(i, 1);
    }
  });
}

export function acceptBlock(date: ISODate, blockId: string) {
  editBlock(date, blockId, (b) => {
    b.status = 'accepted';
    b.locked = true;
  });
}
export function unlockBlock(date: ISODate, blockId: string) {
  editBlock(date, blockId, (b) => {
    b.locked = false;
    if (b.type === 'task') b.status = 'proposed';
  });
}

/** Remove from today's plan without touching the task, then refill the gap. */
export function rejectBlock(date: ISODate, blockId: string, refill = true) {
  update((d) => {
    const plan = d.plans[date];
    if (!plan) return;
    const b = plan.blocks.find((x) => x.id === blockId);
    if (!b?.taskId) return;
    plan.rejectedTaskIds = [...new Set([...plan.rejectedTaskIds, b.taskId])];
    plan.blocks = plan.blocks.filter((x) => x.taskId !== b.taskId);
  });
  if (refill) generateFor(date);
}

export function restoreRejected(date: ISODate, taskId: string) {
  update((d) => {
    const plan = d.plans[date];
    if (plan) plan.rejectedTaskIds = plan.rejectedTaskIds.filter((x) => x !== taskId);
  });
  generateFor(date);
}

export function acceptAll(date: ISODate) {
  update((d) => {
    const plan = d.plans[date];
    if (!plan) return;
    for (const b of plan.blocks) if (b.type === 'task' && b.status === 'proposed') {
      b.status = 'accepted';
      b.locked = true;
    }
  });
}

// ───────── Goals ─────────

export function addGoal(name: string): string {
  const id = uid('g');
  update((d) => {
    const order = Math.max(-1, ...d.goals.map((g) => g.order)) + 1;
    d.goals.push({
      id,
      name,
      outcome: '',
      why: '',
      horizon: 'annual',
      importance: 3,
      status: 'active',
      order,
      color: GOAL_COLORS[order % GOAL_COLORS.length],
      milestones: [],
    });
  });
  return id;
}
export function updateGoal(id: string, patch: Partial<Goal>) {
  update((d) => {
    const g = d.goals.find((x) => x.id === id);
    if (g) Object.assign(g, patch);
  });
}
export function deleteGoal(id: string) {
  update((d) => {
    d.goals = d.goals.filter((g) => g.id !== id);
    for (const t of d.tasks) t.goalIds = t.goalIds.filter((x) => x !== id);
    d.bottleneck.goalIds = d.bottleneck.goalIds.filter((x) => x !== id);
    for (const c of d.commitments) if (c.goalId === id) c.goalId = undefined;
    for (const c of d.currentPlan) if (c.goalId === id) c.goalId = undefined;
  });
}
export function moveGoal(id: string, dir: -1 | 1) {
  update((d) => {
    const sorted = [...d.goals].sort((a, b) => a.order - b.order);
    const i = sorted.findIndex((g) => g.id === id);
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    sorted.forEach((g, k) => (d.goals.find((x) => x.id === g.id)!.order = k));
  });
}
export function addMilestone(goalId: string, m: Omit<Milestone, 'id' | 'done'>) {
  update((d) => {
    d.goals.find((g) => g.id === goalId)?.milestones.push({ ...m, id: uid('m'), done: false });
  });
}
export function updateMilestone(goalId: string, mid: string, patch: Partial<Milestone>) {
  update((d) => {
    const m = d.goals.find((g) => g.id === goalId)?.milestones.find((x) => x.id === mid);
    if (m) Object.assign(m, patch);
  });
}
export function deleteMilestone(goalId: string, mid: string) {
  update((d) => {
    const g = d.goals.find((x) => x.id === goalId);
    if (g) g.milestones = g.milestones.filter((m) => m.id !== mid);
  });
}

export function setBottleneck(statement: string, goalIds: string[]) {
  update((d) => {
    const today = todayISO();
    if (statement.trim() && statement.trim() !== d.bottleneck.statement)
      d.bottleneck.history = [...d.bottleneck.history, { date: today, statement: statement.trim() }].slice(-20);
    d.bottleneck.statement = statement.trim();
    d.bottleneck.goalIds = goalIds;
    d.bottleneck.updatedAt = today;
  });
}

// ───────── Routine ─────────

export function upsertCommitment(c: Commitment) {
  update((d) => {
    const i = d.commitments.findIndex((x) => x.id === c.id);
    if (i >= 0) d.commitments[i] = c;
    else d.commitments.push(c);
  });
}
export function deleteCommitment(id: string) {
  update((d) => {
    d.commitments = d.commitments.filter((c) => c.id !== id);
  });
}

export function upsertCurrent(c: CurrentBlock) {
  update((d) => {
    const i = d.currentPlan.findIndex((x) => x.id === c.id);
    if (i >= 0) d.currentPlan[i] = c;
    else d.currentPlan.push(c);
  });
}
export function deleteCurrent(id: string) {
  update((d) => {
    d.currentPlan = d.currentPlan.filter((c) => c.id !== id);
  });
}

// ───────── Fresh start ─────────

export interface FreshStartPlan {
  date: ISODate;
  /** What happens to open, one-off tasks. Recurring tasks are routines and always stay. */
  oldTasks: 'park' | 'delete' | 'keep';
  /** Only for a goals clean slate. */
  goals?: {
    keep: string[];
    /** Goals not kept: archived (status "dropped", history intact) or deleted. */
    others: 'archive' | 'delete';
    added: { key: string; name: string; importance: Rating }[];
    bottleneck?: { statement: string; goalKeys: string[] };
  };
  /** New tasks; goalKey is an existing goal id or the key of an added goal. */
  tasks: { title: string; goalKey: string; durationMin?: number; expectedResult?: string; firstStep?: string }[];
}

/**
 * Clear the slate and start the day from your goals. Pure over the draft so it can be
 * tested; routines, settings, completed work and logged time are never touched.
 * New tasks are committed to the day, so they're scheduled ahead of everything else.
 */
export function applyFreshStart(d: AppData, p: FreshStartPlan, makeId: (prefix: string) => string = uid): Record<string, string> {
  const oneOffOpen = (t: Task) => t.recurrence === 'none' && t.status !== 'completed' && t.status !== 'deferred';
  if (p.oldTasks === 'park') {
    for (const t of d.tasks.filter(oneOffOpen)) {
      t.status = 'deferred';
      t.plannedFor = undefined;
      t.snoozedUntil = undefined;
      t.keepBelowBar = undefined;
    }
  } else if (p.oldTasks === 'delete') {
    const gone = new Set(d.tasks.filter(oneOffOpen).map((t) => t.id));
    d.tasks = d.tasks.filter((t) => !gone.has(t.id));
    for (const t of d.tasks) t.dependsOn = t.dependsOn.filter((x) => !gone.has(x));
    for (const plan of Object.values(d.plans)) plan.blocks = plan.blocks.filter((b) => !b.taskId || !gone.has(b.taskId) || b.status === 'done');
  }

  const ids: Record<string, string> = Object.fromEntries(d.goals.map((g) => [g.id, g.id]));
  if (p.goals) {
    const g = p.goals;
    const leaving = new Set(d.goals.filter((x) => !g.keep.includes(x.id) && (x.status === 'active' || x.status === 'paused')).map((x) => x.id));
    if (g.others === 'archive') {
      for (const x of d.goals) if (leaving.has(x.id)) x.status = 'dropped';
    } else {
      d.goals = d.goals.filter((x) => !leaving.has(x.id));
      for (const t of d.tasks) t.goalIds = t.goalIds.filter((x) => !leaving.has(x));
      for (const c of d.commitments) if (c.goalId && leaving.has(c.goalId)) c.goalId = undefined;
      for (const c of d.currentPlan) if (c.goalId && leaving.has(c.goalId)) c.goalId = undefined;
      for (const k of [...leaving]) delete ids[k];
    }
    let order = Math.max(-1, ...d.goals.map((x) => x.order)) + 1;
    for (const a of g.added.filter((a) => a.name.trim())) {
      const id = makeId('g');
      ids[a.key] = id;
      d.goals.push({ id, name: a.name.trim(), outcome: '', why: '', horizon: 'annual', importance: a.importance, status: 'active', order, color: GOAL_COLORS[order % GOAL_COLORS.length], milestones: [] });
      order++;
    }
    // The old bottleneck described the old goals; replace it, or clear it.
    const statement = g.bottleneck?.statement.trim() ?? '';
    if (statement && statement !== d.bottleneck.statement) d.bottleneck.history = [...d.bottleneck.history, { date: p.date, statement }].slice(-20);
    d.bottleneck.statement = statement;
    d.bottleneck.goalIds = statement ? (g.bottleneck?.goalKeys ?? []).map((k) => ids[k]).filter(Boolean) : [];
    d.bottleneck.updatedAt = p.date;
  }

  for (const t of p.tasks.filter((t) => t.title.trim() && ids[t.goalKey]).reverse())
    d.tasks.unshift({
      id: makeId('t'),
      title: t.title.trim(),
      goalIds: [ids[t.goalKey]],
      expectedResult: t.expectedResult?.trim() || undefined,
      firstStep: t.firstStep?.trim() || undefined,
      durationMin: t.durationMin,
      dependsOn: [],
      recurrence: 'none',
      status: 'ready',
      createdAt: p.date,
      postponeCount: 0,
      plannedFor: p.date,
    });
  return ids;
}

/** Apply a fresh start, then rebuild that day's plan from scratch (finished blocks stay). */
export function freshStart(p: FreshStartPlan) {
  update((d) => { applyFreshStart(d, p); });
  generateFor(p.date, false);
}

// ───────── Reviews ─────────

/** When an unfinished task gets picked up again: a date, the planner's choice, or someday. */
export type PickUp = 'auto' | 'someday' | ISODate;

export interface ReviewRow {
  taskId: string;
  done: boolean;
  minutes: number;
  outcome?: string;
  /** Unfinished only: where you stopped / the next step. */
  resume?: string;
  pickUp?: PickUp;
}

/**
 * Save a daily review. Completed rows close their tasks and log time; missed rows
 * return to "ready" and count a postponement (a signal, never a penalty).
 */
export function saveDailyReview(review: Omit<DailyReview, 'savedAt' | 'completedTaskIds' | 'missedTaskIds'>, rows: ReviewRow[], distractions: { title: string; minutes: number }[]) {
  const prev = store.get().dailyReviews[review.date];
  update((d) => {
    const date = review.date;
    for (const r of rows) {
      const t = d.tasks.find((x) => x.id === r.taskId);
      if (!t) continue;
      d.actuals = d.actuals.filter((a) => !(a.date === date && a.taskId === r.taskId));
      if (r.done) {
        if (t.recurrence !== 'none') t.lastDoneOn = date;
        else {
          t.status = 'completed';
          t.completedAt = date;
        }
        t.actualMin = r.minutes || t.actualMin;
        if (r.outcome) t.outcome = r.outcome;
        t.resumeNote = undefined;
        t.plannedFor = undefined;
      } else {
        if (t.status === 'completed' && t.completedAt === date) {
          t.status = 'ready';
          t.completedAt = undefined;
        }
        if (!prev?.missedTaskIds.includes(t.id)) t.postponeCount += 1;
        if (t.status === 'scheduled' || t.status === 'in_progress') t.status = 'ready';
        // Giving unfinished work a specific "when" is what lets your mind let go of it
        // (Masicampo & Baumeister 2011).
        if (r.resume?.trim()) t.resumeNote = { text: r.resume.trim(), date };
        if (r.pickUp === 'someday') {
          t.status = 'deferred';
          t.plannedFor = undefined;
        } else if (r.pickUp && r.pickUp !== 'auto') t.plannedFor = r.pickUp;
        else if (r.pickUp === 'auto') t.plannedFor = undefined;
      }
      if (r.minutes > 0) d.actuals.push({ id: uid('a'), date, title: t.title, minutes: r.minutes, taskId: t.id });
    }
    d.actuals = d.actuals.filter((a) => !(a.date === date && a.distraction));
    for (const x of distractions.filter((x) => x.title.trim() && x.minutes > 0))
      d.actuals.push({ id: uid('a'), date, title: x.title.trim(), minutes: x.minutes, distraction: true });
    const plan = d.plans[date];
    if (plan) for (const b of plan.blocks) {
      const r = rows.find((x) => x.taskId === b.taskId);
      if (r) b.status = r.done ? 'done' : 'skipped';
      if (b.type === 'shutdown') b.status = 'done';
    }
    d.dailyReviews[date] = {
      ...review,
      completedTaskIds: rows.filter((r) => r.done).map((r) => r.taskId),
      missedTaskIds: rows.filter((r) => !r.done).map((r) => r.taskId),
      savedAt: new Date().toISOString(),
    };
  });
}

export function saveWeeklyReview(r: Omit<WeeklyReview, 'savedAt'>) {
  update((d) => {
    d.weeklyReviews[r.weekStart] = { ...r, savedAt: new Date().toISOString() };
  });
}

export function finishOnboarding() {
  update((d) => {
    d.onboarded = true;
  });
}
