/**
 * Triage and the leverage bar.
 *
 * People reliably pick urgent-looking, low-payoff tasks over important ones (the
 * "mere urgency effect", Zhu, Yang & Hsee 2018), and the effect shrinks when the
 * payoff is shown at the moment of choice. So the planner leaves tasks below the bar
 * out of the day, and Triage asks you to decide about each one with its score in view.
 */
import type { ISODate, Settings, Task, Tier } from '../domain/types';
import { daysBetween } from '../domain/time';
import type { Classification } from './classify';
import type { RankedTask } from './scoring';

export type BarStatus = { below: false } | { below: true; exempt?: string };

export const isSnoozed = (t: Task, date: ISODate) => !!t.snoozedUntil && t.snoozedUntil > date;

export function barStatus(t: Task, score: number, tier: Tier, date: ISODate, bar: number, isPrerequisite: boolean): BarStatus {
  if (bar <= 0 || score >= bar) return { below: false };
  const exempt =
    t.keepBelowBar ? 'You chose to keep it'
    : t.plannedFor === date ? 'You committed to doing it today'
    : t.deadline && daysBetween(date, t.deadline) <= 1 ? 'Due within a day'
    : isPrerequisite ? 'Unblocks another task'
    : tier === 'maintain' ? 'Upkeep is protected, not scored'
    : tier === 'protect' ? 'Protected: it attacks your bottleneck'
    : undefined;
  return { below: true, exempt };
}

export interface TriageItem {
  ranked: RankedTask;
  tier: Tier;
  exempt?: string;
  /** Its score comes mostly from urgency — it feels pressing, but the payoff is small. */
  urgencyLed: boolean;
}

export interface Triage {
  /** Below the bar and waiting for a decision. */
  queue: TriageItem[];
  /** Below the bar but still scheduled, with the reason. */
  exempt: TriageItem[];
  clearing: number;
  open: number;
  snoozed: Task[];
}

export function triage(ranked: RankedTask[], classes: Map<string, Classification>, settings: Pick<Settings, 'leverageBar'>, date: ISODate): Triage {
  const prerequisiteIds = new Set(ranked.flatMap((r) => r.task.dependsOn));
  const queue: TriageItem[] = [];
  const exempt: TriageItem[] = [];
  const snoozed: Task[] = [];
  let open = 0;
  let clearing = 0;
  for (const r of ranked) {
    const t = r.task;
    if (t.status === 'inbox') continue;
    if (isSnoozed(t, date)) {
      snoozed.push(t);
      continue;
    }
    open++;
    const tier = classes.get(t.id)?.tier ?? 'optional';
    const s = barStatus(t, r.result.score, tier, date, settings.leverageBar, prerequisiteIds.has(t.id));
    if (!s.below) {
      clearing++;
      continue;
    }
    const top = [...r.result.factors].sort((a, b) => b.contribution - a.contribution)[0];
    const item: TriageItem = { ranked: r, tier, exempt: s.exempt, urgencyLed: top?.key === 'urgency' };
    (s.exempt ? exempt : queue).push(item);
  }
  const byScore = (a: TriageItem, b: TriageItem) => a.ranked.result.score - b.ranked.result.score;
  return { queue: queue.sort(byScore), exempt: exempt.sort(byScore), clearing, open, snoozed };
}
