/**
 * Availability: turns a day's routine, fixed commitments and travel into the
 * free windows the scheduler is allowed to use.
 */
import type { Commitment, Energy, ISODate, Minutes, Settings } from '../domain/types';
import { dayOfWeek, fmtTime } from '../domain/time';

export interface Interval {
  start: Minutes;
  end: Minutes;
}

export interface BusySpan extends Interval {
  commitment: Commitment;
  kind: 'commitment' | 'travel';
}

export interface FreeWindow extends Interval {
  /** Set when the window is sandwiched between two commitments at the same non-home place. */
  location?: string;
}

export interface Availability {
  date: ISODate;
  dayStart: Minutes;
  dayEnd: Minutes;
  busy: BusySpan[];
  windows: FreeWindow[];
  freeMin: Minutes;
  overlaps: { a: Commitment; b: Commitment; viaTravel: boolean }[];
}

export const len = (i: Interval) => Math.max(0, i.end - i.start);
export const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Subtract `cut` from every interval in `list`. */
export function subtract(list: Interval[], cut: Interval): Interval[] {
  const out: Interval[] = [];
  for (const i of list) {
    if (!overlaps(i, cut)) {
      out.push(i);
      continue;
    }
    if (cut.start > i.start) out.push({ start: i.start, end: cut.start });
    if (cut.end < i.end) out.push({ start: cut.end, end: i.end });
  }
  return out.filter((i) => len(i) > 0);
}

export function commitmentsForDate(commitments: Commitment[], date: ISODate): Commitment[] {
  const dow = dayOfWeek(date);
  return commitments
    .filter((c) => (c.date ? c.date === date : c.days.includes(dow)))
    .sort((a, b) => a.start - b.start);
}

export function energyAt(settings: Settings, m: Minutes): Energy {
  return settings.energy.find((p) => m >= p.start && m < p.end)?.level ?? 'medium';
}

export function inFocusWindow(settings: Settings, start: Minutes, end: Minutes): boolean {
  return settings.focusWindows.some((w) => start >= w.start && end <= w.end);
}

export function computeAvailability(
  date: ISODate,
  settings: Settings,
  commitments: Commitment[],
  /** Commitment-id → user-moved position (from locked plan blocks). */
  moved: Record<string, Interval> = {},
  minWindow: Minutes = 15,
): Availability {
  const dayStart = settings.wake;
  const dayEnd = settings.sleep > settings.wake ? settings.sleep : 24 * 60;
  const todays = commitmentsForDate(commitments, date).map((c) =>
    moved[c.id] ? { ...c, start: moved[c.id].start, end: moved[c.id].end } : c,
  );

  const busy: BusySpan[] = [];
  for (const c of todays) {
    if (c.travelBeforeMin)
      busy.push({ start: c.start - c.travelBeforeMin, end: c.start, commitment: c, kind: 'travel' });
    busy.push({ start: c.start, end: c.end, commitment: c, kind: 'commitment' });
    if (c.travelAfterMin) busy.push({ start: c.end, end: c.end + c.travelAfterMin, commitment: c, kind: 'travel' });
  }
  busy.sort((a, b) => a.start - b.start);

  // Travel counts too: leaving at 7:00 clashes with breakfast until 7:15. Consecutive
  // events at the same place need no travel between them, so they're exempt.
  const withTravel = (c: Commitment): Interval => ({ start: c.start - (c.travelBeforeMin ?? 0), end: c.end + (c.travelAfterMin ?? 0) });
  const overlapPairs: { a: Commitment; b: Commitment; viaTravel: boolean }[] = [];
  for (let i = 0; i < todays.length; i++)
    for (let j = i + 1; j < todays.length; j++) {
      const [a, b] = [todays[i], todays[j]];
      if (overlaps(a, b)) overlapPairs.push({ a, b, viaTravel: false });
      // For travel clashes, `a` is the event whose travel causes it.
      else if (!(a.location && a.location === b.location)) {
        if (overlaps(withTravel(a), b)) overlapPairs.push({ a, b, viaTravel: true });
        else if (overlaps(a, withTravel(b))) overlapPairs.push({ a: b, b: a, viaTravel: true });
      }
    }

  let free: Interval[] = [{ start: dayStart, end: dayEnd }];
  for (const b of busy) free = subtract(free, b);

  const windows: FreeWindow[] = free
    .filter((w) => len(w) >= minWindow)
    .map((w) => {
      const prev = [...busy].reverse().find((b) => b.end <= w.start && w.start - b.end <= 1);
      const next = busy.find((b) => b.start >= w.end && b.start - w.end <= 1);
      const loc =
        prev?.commitment.location &&
        prev.commitment.location === next?.commitment.location &&
        prev.commitment.location !== settings.homeLocation
          ? prev.commitment.location
          : undefined;
      return loc ? { ...w, location: loc } : { ...w };
    });

  return {
    date,
    dayStart,
    dayEnd,
    busy,
    windows,
    freeMin: windows.reduce((s, w) => s + len(w), 0),
    overlaps: overlapPairs,
  };
}

export function describeWindow(w: Interval) {
  return `${fmtTime(w.start)}–${fmtTime(w.end)}`;
}
