/** Small builders shared by engine tests. */
import type { Commitment, Goal, Settings, Task } from '../domain/types';
import { DEFAULT_WEIGHTS } from './scoring';

export const H = (h: number, m = 0) => h * 60 + m;

export function goal(p: Partial<Goal> & { id: string }): Goal {
  return {
    name: p.id,
    outcome: '',
    why: '',
    horizon: 'annual',
    importance: 3,
    status: 'active',
    order: 0,
    color: 'blue',
    milestones: [],
    ...p,
  };
}

export function task(p: Partial<Task> & { id: string }): Task {
  return {
    title: p.id,
    goalIds: [],
    dependsOn: [],
    recurrence: 'none',
    status: 'ready',
    createdAt: '2026-10-01',
    postponeCount: 0,
    ...p,
  };
}

export function commitment(p: Partial<Commitment> & { id: string; start: number; end: number }): Commitment {
  return { title: p.id, kind: 'routine', days: [0, 1, 2, 3, 4, 5, 6], fixed: true, essential: false, ...p };
}

export function settings(p: Partial<Settings> = {}): Settings {
  return {
    wake: H(7),
    sleep: H(22),
    focusWindows: [{ start: H(8), end: H(11) }],
    energy: [
      { start: H(7), end: H(12), level: 'high' },
      { start: H(12), end: H(16), level: 'medium' },
      { start: H(16), end: H(22), level: 'low' },
    ],
    bufferMin: 10,
    breakAfterMin: 90,
    breakMin: 15,
    unscheduledMin: 0,
    maxBlockMin: 120,
    maxWorkMin: 720,
    defaultDurationMin: 30,
    homeLocation: 'home',
    weights: { ...DEFAULT_WEIGHTS },
    ...p,
  };
}
