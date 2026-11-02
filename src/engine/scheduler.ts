/**
 * Scheduling engine.
 *
 * 1. Compute free windows (routine, fixed commitments, travel, sleep).
 * 2. Keep anything the user locked (moved / resized / accepted).
 * 3. Rank eligible tasks, then greedily place them — re-ranking after every
 *    placement so one goal can't swallow the whole day.
 * 4. Each placement picks the best slot for the task: energy match, focus windows,
 *    same-goal adjacency (less context switching), dependencies, and location.
 * 5. Buffers follow every task; a real break is inserted after long focus runs.
 * 6. A slice of the day stays deliberately unscheduled.
 * 7. Anything important that didn't fit is reported with concrete fixes.
 *
 * Pure function: same input → same plan.
 */
import type {
  Block,
  Bottleneck,
  Commitment,
  Conflict,
  DayPlan,
  Goal,
  ISODate,
  Minutes,
  Settings,
  Task,
  UnscheduledItem,
} from '../domain/types';
import { dayOfWeek, daysBetween, fmtDuration, fmtTime } from '../domain/time';
import {
  computeAvailability,
  energyAt,
  inFocusWindow,
  len,
  overlaps,
  subtract,
  type Interval,
  type FreeWindow,
} from './availability';
import { rankTasks, type RankedTask } from './scoring';
import { classifyTask } from './classify';

export interface ScheduleInput {
  date: ISODate;
  tasks: Task[];
  goals: Goal[];
  commitments: Commitment[];
  settings: Settings;
  bottleneck?: Bottleneck;
  /** Previous plan for this date — locked blocks and rejections are honoured. */
  previous?: DayPlan;
  recentGoalMinutes?: Record<string, number>;
  /** goalId → actual/estimate ratio learned from reviews (clamped 0.8–1.5). */
  estimateFactors?: Record<string, number>;
  /** Deterministic id factory (tests) — defaults to sequential ids. */
  makeId?: (n: number) => string;
}

interface State {
  free: FreeWindow[];
  blocks: Block[];
}

const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** Is a (possibly recurring) task due on `date`? */
export function occursOn(task: Task, date: ISODate): boolean {
  if (task.recurrence === 'none') return true;
  if (task.lastDoneOn === date) return false;
  const dow = dayOfWeek(date);
  if (task.recurrence === 'daily') return true;
  if (task.recurrence === 'weekdays') return dow >= 1 && dow <= 5;
  if (task.recurrence === 'weekly') return (task.recurrenceDay ?? 1) === dow;
  return true;
}

export function generatePlan(input: ScheduleInput): DayPlan {
  const { date, settings, goals } = input;
  let idN = 0;
  const makeId = input.makeId ?? ((n: number) => `blk_${date}_${n}`);
  const nextId = () => makeId(++idN);

  const prev = input.previous;
  const rejected = new Set(prev?.rejectedTaskIds ?? []);
  const keep = (prev?.blocks ?? []).filter(
    (b) => (b.locked || b.status === 'done') && b.status !== 'rejected' && (b.type === 'task' || b.type === 'commitment'),
  );
  const moved: Record<string, Interval> = {};
  for (const b of keep) if (b.type === 'commitment' && b.commitmentId) moved[b.commitmentId] = b;

  const avail = computeAvailability(date, settings, input.commitments, moved);

  const blocks: Block[] = [];
  for (const span of avail.busy) {
    const c = span.commitment;
    const lockedVersion = keep.find((b) => b.type === 'commitment' && b.commitmentId === c.id);
    if (span.kind === 'commitment') {
      blocks.push({
        id: lockedVersion?.id ?? nextId(),
        date,
        start: span.start,
        end: span.end,
        title: c.title,
        type: 'commitment',
        commitmentId: c.id,
        goalIds: c.goalId ? [c.goalId] : [],
        status: lockedVersion?.status ?? 'accepted',
        fixed: c.fixed,
        essential: c.essential,
        locked: !!lockedVersion,
      });
    } else {
      blocks.push({
        id: nextId(),
        date,
        start: span.start,
        end: span.end,
        title: `Travel · ${c.title}`,
        type: 'travel',
        commitmentId: c.id,
        goalIds: [],
        status: 'accepted',
        fixed: c.fixed,
      });
    }
  }

  let state: State = { free: avail.windows.map((w) => ({ ...w })), blocks };

  // Locked task blocks stay exactly where the user put them — unless a commitment
  // (e.g. a newly added must-attend event) now sits on top, in which case the task is re-placed.
  const lockedTaskIds = new Set<string>();
  const bumped: { title: string; clash: string }[] = [];
  for (const b of keep.filter((b) => b.type === 'task')) {
    const clash = b.status !== 'done' ? avail.busy.find((s) => overlaps(s, b)) : undefined;
    if (clash) {
      bumped.push({ title: b.title, clash: clash.commitment.title });
      continue;
    }
    state.blocks.push({ ...b });
    state.free = subtractWindows(state.free, b);
    if (b.taskId) lockedTaskIds.add(b.taskId);
  }

  const tasksById = new Map(input.tasks.map((t) => [t.id, t]));
  const ranked = rankTasks(input.tasks, settings.weights, {
    today: date,
    goals,
    bottleneck: input.bottleneck,
    tasksById,
    recentGoalMinutes: input.recentGoalMinutes,
  });
  const rankedById = new Map(ranked.map((r) => [r.task.id, r]));

  const unscheduled: UnscheduledItem[] = [];
  const pending = new Map<string, RankedTask>();
  // A prerequisite inherits importance from what it unblocks — never filter it out as low-leverage.
  const prerequisiteIds = new Set(ranked.flatMap((r) => r.task.dependsOn));
  for (const r of ranked) {
    const t = r.task;
    if (lockedTaskIds.has(t.id)) continue;
    if (!occursOn(t, date)) continue;
    if (rejected.has(t.id)) continue;
    if (t.status === 'inbox') {
      unscheduled.push({ taskId: t.id, reason: 'Still in the inbox — clarify it into a concrete next action first', important: false });
      continue;
    }
    const cls = classifyTask(t, r.result, goals);
    if (cls.tier === 'reduce' && !prerequisiteIds.has(t.id)) {
      unscheduled.push({ taskId: t.id, reason: 'Flagged as low-leverage — left out on purpose', important: false });
      continue;
    }
    pending.set(t.id, r);
  }

  const isImportant = (r: RankedTask) => {
    const cls = classifyTask(r.task, r.result, goals);
    const due = r.task.deadline ? daysBetween(date, r.task.deadline) : 99;
    return cls.tier === 'protect' || due <= 1;
  };
  const dueToday = (t: Task) => !!t.deadline && daysBetween(date, t.deadline) <= 0;

  const placedPerGoal: Record<string, number> = {};
  const placed = new Set<string>();
  const failed = new Map<string, string>();

  const durationFor = (t: Task) => {
    const base = t.durationMin ?? settings.defaultDurationMin;
    const g = t.goalIds[0];
    const f = g && input.estimateFactors?.[g] ? Math.min(1.5, Math.max(0.8, input.estimateFactors[g])) : 1;
    return round5(base * f);
  };

  const freeTotal = (s: State) => s.free.reduce((a, w) => a + len(w), 0);
  const taskMinutes = (s: State) => s.blocks.filter((b) => b.type === 'task').reduce((a, b) => a + b.end - b.start, 0);

  /** Place a task (and, first, any prerequisites that can be done today). */
  const placeTask = (r: RankedTask, depth = 0, note?: string): boolean => {
    const t = r.task;
    if (placed.has(t.id)) return true;
    if (failed.has(t.id)) return false;

    // Dependencies
    let minStart = avail.dayStart;
    for (const depId of r.result.blockedBy) {
      const dep = tasksById.get(depId)!;
      const depRanked = pending.get(depId) ?? rankedById.get(depId);
      const lockedDep = state.blocks.filter((b) => b.taskId === depId);
      if (lockedDep.length) {
        minStart = Math.max(minStart, ...lockedDep.map((b) => b.end));
        continue;
      }
      if (depth < 3 && depRanked && pending.has(depId) && placeTask(depRanked, depth + 1, `Prerequisite for “${t.title}”`)) {
        const depBlocks = state.blocks.filter((b) => b.taskId === depId);
        minStart = Math.max(minStart, ...depBlocks.map((b) => b.end));
        continue;
      }
      failed.set(t.id, `Waiting on “${dep.title}”, which can't happen first today`);
      return false;
    }

    const d = durationFor(t);
    const mustSplit = d > settings.maxBlockMin && t.splittable !== false;
    const attempts: number[][] = mustSplit
      ? [splitInto(d, Math.ceil(d / settings.maxBlockMin))]
      : t.splittable && d >= 60
        ? [[d], splitInto(d, 2)]
        : [[d]];

    for (const chunks of attempts) {
      const next = tryChunks(state, t, r, chunks, minStart, note);
      if (!next) continue;
      const workAfter = taskMinutes(next);
      if (workAfter > settings.maxWorkMin && !dueToday(t)) {
        failed.set(t.id, `Would push today past your ${fmtDuration(settings.maxWorkMin)} cap on focused work`);
        return false;
      }
      const slackAfter = freeTotal(next);
      if (slackAfter < settings.unscheduledMin && !dueToday(t)) {
        failed.set(
          t.id,
          `Would cut into the ${fmtDuration(settings.unscheduledMin)} of open time you asked to keep`,
        );
        return false;
      }
      state = next;
      placed.add(t.id);
      const g = r.result.primaryGoalId ?? '_none';
      placedPerGoal[g] = (placedPerGoal[g] ?? 0) + 1;
      return true;
    }

    const largest = Math.max(0, ...state.free.filter((w) => !t.location || !w.location || w.location === t.location).map(len));
    failed.set(
      t.id,
      t.location && state.free.length > 0 && state.free.every((w) => w.location && w.location !== t.location)
        ? `Needs to happen at “${t.location}” — every open window today is somewhere else`
        : largest === 0
          ? 'No free time left today'
          : `Needs ${fmtDuration(d)}; the largest open window is ${fmtDuration(largest)}`,
    );
    return false;
  };

  const tryChunks = (
    s0: State,
    t: Task,
    r: RankedTask,
    chunks: number[],
    minStart: Minutes,
    note?: string,
  ): State | null => {
    let s: State = { free: s0.free.map((w) => ({ ...w })), blocks: [...s0.blocks] };
    let earliest = minStart;
    for (let i = 0; i < chunks.length; i++) {
      const slot = bestSlot(s, t, r, chunks[i], earliest);
      if (!slot) return null;
      s = commit(s, t, slot, chunks.length > 1 ? { index: i + 1, of: chunks.length } : undefined, note);
      earliest = slot.start + chunks[i];
    }
    return s;
  };

  interface Slot {
    start: Minutes;
    end: Minutes;
    window: FreeWindow;
    breakFrom?: Minutes;
    score: number;
  }

  const bestSlot = (s: State, t: Task, r: RankedTask, d: Minutes, minStart: Minutes): Slot | null => {
    let best: Slot | null = null;
    for (const w of s.free) {
      if (t.location && w.location && w.location !== t.location) continue;
      if (t.location && t.location !== settings.homeLocation && !w.location && t.location !== 'anywhere') {
        // A task that must happen somewhere specific needs travel; allow it only in
        // a window long enough to absorb a 20-minute round trip.
        if (len(w) < d + 20) continue;
      }
      const starts = new Set<Minutes>([Math.max(w.start, minStart)]);
      for (const f of settings.focusWindows) if (f.start > w.start && f.start < w.end) starts.add(Math.max(f.start, minStart));
      for (const p of settings.energy) if (p.start > w.start && p.start < w.end) starts.add(Math.max(p.start, minStart));
      // Also try ending flush with the window, so short tasks can tuck in late.
      starts.add(Math.max(minStart, w.end - d));

      for (let start of starts) {
        if (start < w.start) continue;
        let breakFrom: Minutes | undefined;
        const run = contiguousRun(s.blocks, start, settings.bufferMin);
        if (run.minutes > 0 && run.minutes + d > settings.breakAfterMin) {
          breakFrom = run.lastEnd;
          start = Math.max(start, run.lastEnd + settings.breakMin);
        }
        const end = start + d;
        if (end > w.end) continue;
        const score = slotScore(s, t, r, start, end);
        if (!best || score > best.score) best = { start, end, window: w, breakFrom, score };
      }
    }
    return best;
  };

  const slotScore = (s: State, t: Task, r: RankedTask, start: Minutes, end: Minutes) => {
    const e = energyAt(settings, start);
    const need = t.energy ?? 'medium';
    let sc = 0;
    if (need === 'high') sc += e === 'high' ? 3 : e === 'medium' ? 0.5 : -2.5;
    if (need === 'medium') sc += e === 'low' ? -1 : 1;
    if (need === 'low') sc += e === 'low' ? 1.5 : e === 'high' ? -1 : 0.5; // save peaks for hard work
    const focus = inFocusWindow(settings, start, end);
    if (focus) sc += need === 'high' ? 2 : need === 'low' ? -1.5 : 0.5;
    // Less context switching: reward sitting next to work on the same goal.
    const g = r.result.primaryGoalId;
    if (g) {
      const adj = s.blocks.find(
        (b) =>
          b.type === 'task' &&
          b.goalIds.includes(g) &&
          (Math.abs(b.end - start) <= settings.bufferMin + settings.breakMin || Math.abs(end - b.start) <= settings.bufferMin),
      );
      if (adj) sc += 1.5;
    }
    // Deadline today → earlier is safer; otherwise a gentle earliness tie-break.
    sc -= (start / 1440) * (dueToday(t) ? 3 : 0.6);
    return sc;
  };

  const commit = (s: State, t: Task, slot: Slot, chunk?: { index: number; of: number }, note?: string): State => {
    const blocks = [...s.blocks];
    let free = s.free;
    if (slot.breakFrom !== undefined) {
      const buf = blocks.findIndex((b) => b.type === 'buffer' && b.start === slot.breakFrom);
      if (buf >= 0) blocks.splice(buf, 1);
      blocks.push({
        id: nextId(),
        date,
        start: slot.breakFrom,
        end: slot.start,
        title: 'Break',
        type: 'break',
        goalIds: [],
        status: 'proposed',
        fixed: false,
        essential: true,
      });
      free = subtractWindows(free, { start: slot.breakFrom, end: slot.start });
    }
    blocks.push({
      id: nextId(),
      date,
      start: slot.start,
      end: slot.end,
      title: t.title,
      type: 'task',
      taskId: t.id,
      goalIds: t.goalIds,
      status: 'proposed',
      fixed: false,
      chunk,
      note,
    });
    let consumedEnd = slot.end;
    const room = slot.window.end - slot.end;
    if (room > 0 && settings.bufferMin > 0) {
      const bufEnd = slot.end + Math.min(settings.bufferMin, room);
      blocks.push({
        id: nextId(),
        date,
        start: slot.end,
        end: bufEnd,
        title: 'Buffer',
        type: 'buffer',
        goalIds: [],
        status: 'proposed',
        fixed: false,
      });
      consumedEnd = bufEnd;
    }
    free = subtractWindows(free, { start: slot.start, end: consumedEnd });
    return { free, blocks };
  };

  // Greedy loop with re-ranking for balance.
  const boost = (r: RankedTask) => {
    const g = r.result.primaryGoalId ?? '_none';
    const dup = placedPerGoal[g] ?? 0;
    return r.result.score - 6 * dup + (dueToday(r.task) ? 15 : 0);
  };
  while (true) {
    const candidates = [...pending.values()].filter((r) => !placed.has(r.task.id) && !failed.has(r.task.id));
    if (!candidates.length) break;
    candidates.sort((a, b) => boost(b) - boost(a) || a.rank - b.rank);
    placeTask(candidates[0]);
  }

  for (const [id, r] of pending) {
    if (placed.has(id)) continue;
    unscheduled.push({ taskId: id, reason: failed.get(id) ?? 'Did not fit', important: isImportant(r) });
  }
  unscheduled.sort((a, b) => Number(b.important) - Number(a.important));

  // Conflicts & suggestions
  const conflicts: Conflict[] = [];
  for (const o of avail.overlaps) {
    conflicts.push({
      severity: 'critical',
      message: o.viaTravel
        ? `Travel time for “${o.a.title}” runs into “${o.b.title}”.`
        : `“${o.a.title}” (${fmtTime(o.a.start)}) overlaps “${o.b.title}” (${fmtTime(o.b.start)}).`,
      suggestions: [
        o.a.fixed && o.b.fixed
          ? 'Both are marked fixed — one of them has to move. Edit it in Routine.'
          : `Move the flexible one (“${!o.a.fixed ? o.a.title : o.b.title}”) in the Plan view.`,
      ],
    });
  }

  for (const m of bumped)
    conflicts.push({
      severity: 'info',
      message: `“${m.title}” was moved because it clashed with “${m.clash}”.`,
      suggestions: ['Check its new slot, or drag it somewhere else.'],
    });

  const placedTasks = state.blocks
    .filter((b) => b.type === 'task' && !b.locked && b.taskId)
    .map((b) => ({ b, r: rankedById.get(b.taskId!)! }))
    .filter((x) => x.r);
  const largestFree = Math.max(0, ...state.free.map(len));
  for (const u of unscheduled.filter((u) => u.important).slice(0, 3)) {
    const t = tasksById.get(u.taskId)!;
    const d = durationFor(t);
    const sugg: string[] = [];
    const weaker = placedTasks
      .filter((x) => x.r.result.score < (rankedById.get(t.id)?.result.score ?? 0))
      .sort((a, b) => a.r.result.score - b.r.result.score);
    const swap = weaker.find((x) => x.b.end - x.b.start + largestFree >= d) ?? weaker[0];
    if (swap)
      sugg.push(
        `Postpone “${swap.b.title}” (ranked lower) to free ${fmtDuration(swap.b.end - swap.b.start)} at ${fmtTime(
          swap.b.start,
        )}.`,
      );
    if (largestFree >= 30 && d > largestFree)
      sugg.push(`Shorten it to a ${fmtDuration(Math.floor(largestFree / 5) * 5)} first pass — that fits now.`);
    if (!t.splittable && d >= 60) sugg.push('Allow it to be split into two sessions.');
    sugg.push(dueToday(t) ? 'It is due today — ask for an extension if none of these work.' : 'Schedule it first thing tomorrow.');
    conflicts.push({
      severity: dueToday(t) ? 'critical' : 'warning',
      message: `“${t.title}” didn't fit: ${u.reason.toLowerCase()}.`,
      suggestions: sugg,
    });
  }

  const sleepHours = (24 * 60 - (settings.sleep - settings.wake)) / 60;
  if (sleepHours < 7)
    conflicts.push({
      severity: 'warning',
      message: `Your day window leaves only ${sleepHours.toFixed(1)}h for sleep.`,
      suggestions: ['Move bedtime earlier or wake later in Routine — the plan will not borrow from sleep.'],
    });
  if (avail.freeMin < 90)
    conflicts.push({
      severity: 'info',
      message: `Commitments leave only ${fmtDuration(avail.freeMin)} of flexible time today.`,
      suggestions: ['Check whether every commitment is truly fixed, or treat today as a maintenance day.'],
    });

  state.blocks.sort((a, b) => a.start - b.start || typeRank(a) - typeRank(b));
  const plannedTaskMin = state.blocks.filter((b) => b.type === 'task').reduce((s, b) => s + (b.end - b.start), 0);

  return {
    date,
    blocks: state.blocks,
    unscheduled,
    conflicts,
    rejectedTaskIds: [...rejected],
    generatedAt: new Date().toISOString(),
    stats: { freeMin: avail.freeMin, plannedTaskMin, slackMin: freeTotal(state) },
  };
}

const typeRank = (b: Block) => ['travel', 'commitment', 'task', 'break', 'buffer'].indexOf(b.type);

function subtractWindows(free: FreeWindow[], cut: Interval): FreeWindow[] {
  const out: FreeWindow[] = [];
  for (const w of free) {
    for (const piece of subtract([w], cut)) out.push({ ...piece, location: w.location });
  }
  return out.filter((w) => len(w) >= 5);
}

export function splitInto(total: Minutes, n: number): number[] {
  const base = Math.floor(total / n / 5) * 5;
  const out = Array(n).fill(base);
  out[0] += total - base * n;
  return out;
}

/** Length of continuous task work ending within `gap` minutes before `start`. */
function contiguousRun(blocks: Block[], start: Minutes, gap: Minutes): { minutes: number; lastEnd: Minutes } {
  const tasks = blocks.filter((b) => b.type === 'task').sort((a, b) => b.end - a.end);
  let cursor = start;
  let minutes = 0;
  let lastEnd = start;
  let first = true;
  for (const b of tasks) {
    if (b.end > cursor) continue;
    if (cursor - b.end > gap) break;
    // A break between them resets the run.
    if (blocks.some((x) => x.type === 'break' && x.start >= b.end && x.end <= cursor)) break;
    if (first) lastEnd = b.end;
    first = false;
    minutes += b.end - b.start;
    cursor = b.start;
  }
  return { minutes, lastEnd };
}
