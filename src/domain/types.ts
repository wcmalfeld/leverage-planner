/**
 * Domain model for the Personal Leverage Planner.
 *
 * Conventions
 * - Times of day are minutes since local midnight (0–1440).
 * - Dates are local ISO dates: "YYYY-MM-DD".
 * - Ratings are 1–5 integers; `undefined` means "not estimated yet" and the
 *   engine falls back to a neutral assumption (and says so in explanations).
 */

export type ISODate = string;
export type Minutes = number;
export type Rating = 1 | 2 | 3 | 4 | 5;

// ───────────────────────────── Goals ─────────────────────────────

export type GoalHorizon = 'vision' | 'annual' | 'quarter' | 'week';
export type GoalStatus = 'active' | 'paused' | 'achieved' | 'dropped';

export interface Milestone {
  id: string;
  title: string;
  horizon: GoalHorizon; // annual goal, 90-day objective, weekly priority
  dueDate?: ISODate;
  done: boolean;
}

export interface GoalMetric {
  label: string; // e.g. "Paying tutoring clients"
  current: number;
  target: number;
  unit?: string;
}

export interface Goal {
  id: string;
  name: string;
  outcome: string; // desired outcome
  why: string; // why it matters
  horizon: GoalHorizon;
  targetDate?: ISODate;
  metric?: GoalMetric;
  importance: Rating;
  status: GoalStatus;
  order: number;
  color: string; // hue token key, see ui/colors
  milestones: Milestone[];
  /** "Sustainability" goals (health, relationships) are protected rather than maximised. */
  sustaining?: boolean;
}

export interface Bottleneck {
  statement: string; // "No reliable income — everything else waits on it"
  goalIds: string[];
  updatedAt: ISODate;
  history: { date: ISODate; statement: string }[];
}

// ───────────────────────────── Tasks ─────────────────────────────

export type TaskStatus = 'inbox' | 'ready' | 'scheduled' | 'in_progress' | 'completed' | 'deferred';
export type Energy = 'low' | 'medium' | 'high';
export type Recurrence = 'none' | 'daily' | 'weekdays' | 'weekly';

/** How the engine classifies a task. Users can override. */
export type Tier = 'protect' | 'maintain' | 'obligation' | 'optional' | 'reduce';

export interface Task {
  id: string;
  title: string;
  goalIds: string[];
  expectedResult?: string; // what "done" produces — doubles as success criteria
  durationMin?: Minutes;
  deadline?: ISODate;
  impact?: Rating;
  confidence?: Rating;
  compounding?: Rating;
  energy?: Energy;
  location?: string; // "home", "town", "trail" … must match the window's location
  dependsOn: string[];
  recurrence: Recurrence;
  recurrenceDay?: number; // 0–6 for weekly
  status: TaskStatus;
  removesBottleneck?: boolean;
  splittable?: boolean; // may be scheduled in two chunks
  tierOverride?: Tier;
  notes?: string;
  parentId?: string; // set when clarified from a vaguer idea
  createdAt: ISODate;
  completedAt?: ISODate;
  actualMin?: Minutes;
  outcome?: string;
  postponeCount: number;
  lastDoneOn?: ISODate; // for recurring tasks
}

// ─────────────────────── Availability & routine ───────────────────────

export type CommitmentKind =
  | 'work'
  | 'meal'
  | 'exercise'
  | 'routine'
  | 'appointment'
  | 'travel'
  | 'social'
  | 'rest';

/** A recurring (days[]) or one-off (date) block of time the scheduler must respect. */
export interface Commitment {
  id: string;
  title: string;
  kind: CommitmentKind;
  days: number[]; // 0=Sun … 6=Sat, used when `date` is absent
  date?: ISODate; // one-off
  start: Minutes;
  end: Minutes;
  fixed: boolean; // fixed = cannot move; flexible = scheduler may slide within ±flexMin
  flexMin?: Minutes;
  essential: boolean; // protected life-support (sleep, meals, training, people)
  goalId?: string;
  location?: string;
  travelBeforeMin?: Minutes;
  travelAfterMin?: Minutes;
}

export interface EnergyPeriod {
  start: Minutes;
  end: Minutes;
  level: Energy;
}

export interface Weights {
  alignment: number;
  impact: number;
  compounding: number;
  urgency: number;
  confidence: number;
  effort: number;
  feasibility: number;
  bottleneck: number;
}

export interface Settings {
  wake: Minutes;
  sleep: Minutes; // bedtime
  focusWindows: { start: Minutes; end: Minutes }[];
  energy: EnergyPeriod[];
  bufferMin: Minutes;
  breakAfterMin: Minutes; // insert a real break after this much continuous task time
  breakMin: Minutes;
  unscheduledMin: Minutes; // desired slack per day
  maxBlockMin: Minutes; // longest single focus block before splitting
  maxWorkMin: Minutes; // daily cap on scheduled task time — protects recovery
  defaultDurationMin: Minutes;
  homeLocation: string;
  weights: Weights;
}

// ───────────────────────────── Schedules ─────────────────────────────

export type BlockType = 'commitment' | 'task' | 'break' | 'buffer' | 'travel';
export type BlockStatus = 'proposed' | 'accepted' | 'rejected' | 'done' | 'skipped';

export interface Block {
  id: string;
  date: ISODate;
  start: Minutes;
  end: Minutes;
  title: string;
  type: BlockType;
  taskId?: string;
  commitmentId?: string;
  goalIds: string[];
  status: BlockStatus;
  fixed: boolean;
  essential?: boolean;
  /** User moved/resized/accepted it — regeneration keeps it in place. */
  locked?: boolean;
  chunk?: { index: number; of: number };
  note?: string; // e.g. "Pulled in as a prerequisite"
}

export interface UnscheduledItem {
  taskId: string;
  reason: string;
  important: boolean;
}

export interface Conflict {
  severity: 'info' | 'warning' | 'critical';
  message: string;
  suggestions: string[];
}

export interface DayPlan {
  date: ISODate;
  blocks: Block[];
  unscheduled: UnscheduledItem[];
  conflicts: Conflict[];
  rejectedTaskIds: string[];
  generatedAt: string;
  /** Fingerprint of the inputs used — lets the UI flag a stale plan. */
  inputSig?: string;
  stats: {
    freeMin: Minutes;
    plannedTaskMin: Minutes;
    slackMin: Minutes;
  };
}

/** "Current plan": what you expect to do anyway. Typical week + dated entries. */
export type CurrentValue = 'essential' | 'high' | 'maintenance' | 'low' | 'distraction';

export interface CurrentBlock {
  id: string;
  title: string;
  days: number[];
  date?: ISODate;
  start: Minutes;
  end: Minutes;
  goalId?: string;
  taskId?: string;
  value?: CurrentValue;
}

/** What actually happened. */
export interface ActualEntry {
  id: string;
  date: ISODate;
  title: string;
  minutes: Minutes;
  taskId?: string;
  goalId?: string;
  distraction?: boolean;
}

// ───────────────────────────── Reviews ─────────────────────────────

export interface DailyReview {
  date: ISODate;
  completedTaskIds: string[];
  missedTaskIds: string[];
  outcomes: string;
  obstacles: string;
  changes: string;
  energy?: Rating;
  savedAt: string;
}

export interface WeeklyReview {
  weekStart: ISODate;
  notes: string;
  nextWeekFocus: string;
  savedAt: string;
}

// ───────────────────────────── Root ─────────────────────────────

export interface AppData {
  version: 1;
  onboarded: boolean;
  goals: Goal[];
  bottleneck: Bottleneck;
  tasks: Task[];
  commitments: Commitment[];
  currentPlan: CurrentBlock[];
  actuals: ActualEntry[];
  plans: Record<ISODate, DayPlan>;
  dailyReviews: Record<ISODate, DailyReview>;
  weeklyReviews: Record<ISODate, WeeklyReview>;
  settings: Settings;
}
