import type { ISODate, Minutes } from './types';

export const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): ISODate {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function parseISO(date: ISODate): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(date: ISODate, n: number): ISODate {
  const d = parseISO(date);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function dayOfWeek(date: ISODate): number {
  return parseISO(date).getDay();
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86_400_000);
}

/** Monday of the week containing `date`. */
export function weekStart(date: ISODate): ISODate {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function fmtTime(m: Minutes): string {
  const h = Math.floor(m / 60) % 24;
  const mm = Math.round(m % 60);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return mm === 0 ? `${h12}${suffix}` : `${h12}:${pad(mm)}${suffix}`;
}

export function fmtDuration(m: Minutes): string {
  m = Math.round(m);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** "HH:MM" ⇄ minutes, for <input type="time">. */
export function toHHMM(m: Minutes): string {
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
export function fromHHMM(s: string): Minutes {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function fmtDateLong(date: ISODate): string {
  return parseISO(date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
export function fmtDateShort(date: ISODate): string {
  return parseISO(date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const snap = (m: Minutes, step = 5) => Math.round(m / step) * step;

let counter = 0;
export function uid(prefix = 'id'): string {
  counter = (counter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${counter.toString(36)}`;
}
