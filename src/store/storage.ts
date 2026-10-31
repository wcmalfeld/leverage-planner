/**
 * Persistence adapters. The app only talks to `StorageAdapter`, so swapping
 * localStorage for IndexedDB, a file, or an opt-in sync backend is a one-file change.
 * Nothing here talks to the network.
 */
import type { AppData } from '../domain/types';

export interface StorageAdapter {
  readonly name: string;
  readonly durable: boolean;
  load(): AppData | null;
  save(data: AppData): void;
  clear(): void;
}

const KEY = 'leverage-planner:v1';

export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'This browser (localStorage)';
  readonly durable = true;
  load(): AppData | null {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as AppData) : null;
  }
  save(data: AppData) {
    localStorage.setItem(KEY, JSON.stringify(data));
  }
  clear() {
    localStorage.removeItem(KEY);
  }
}

/** Used when browser storage is blocked (private mode, sandboxed previews). */
export class MemoryAdapter implements StorageAdapter {
  readonly name = 'Memory only (storage unavailable)';
  readonly durable = false;
  private data: AppData | null = null;
  load() {
    return this.data;
  }
  save(d: AppData) {
    this.data = d;
  }
  clear() {
    this.data = null;
  }
}

export function pickAdapter(): StorageAdapter {
  try {
    const probe = '__lp_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return new LocalStorageAdapter();
  } catch {
    return new MemoryAdapter();
  }
}

/** Validate & upgrade an imported or loaded snapshot. Throws with a readable message. */
export function migrate(input: unknown, fallback: AppData): AppData {
  if (!input || typeof input !== 'object') throw new Error('That file is not a Leverage Planner backup.');
  const d = input as Partial<AppData>;
  if (d.version !== 1) throw new Error(`Unsupported backup version: ${String(d.version)}`);
  if (!Array.isArray(d.goals) || !Array.isArray(d.tasks)) throw new Error('Backup is missing goals or tasks.');
  return {
    ...fallback,
    ...d,
    settings: { ...fallback.settings, ...d.settings, weights: { ...fallback.settings.weights, ...d.settings?.weights } },
    bottleneck: { ...fallback.bottleneck, ...d.bottleneck },
    tasks: d.tasks.map((t) => ({ ...t, dependsOn: t.dependsOn ?? [], recurrence: t.recurrence ?? 'none', postponeCount: t.postponeCount ?? 0, goalIds: t.goalIds ?? [] })),
    plans: d.plans ?? {},
    dailyReviews: d.dailyReviews ?? {},
    weeklyReviews: d.weeklyReviews ?? {},
    actuals: d.actuals ?? [],
    currentPlan: d.currentPlan ?? [],
    commitments: d.commitments ?? [],
  } as AppData;
}
