/**
 * App store: one immutable snapshot, persisted after every change through a
 * StorageAdapter. Components subscribe with `useApp()`.
 */
import { useSyncExternalStore } from 'react';
import type { AppData, DayPlan, ISODate } from '../domain/types';
import { todayISO } from '../domain/time';
import { demoData, emptyData } from './seed';
import { migrate, pickAdapter, type StorageAdapter } from './storage';

type Listener = () => void;

class Store {
  private data: AppData;
  private listeners = new Set<Listener>();
  readonly adapter: StorageAdapter;
  lastError: string | null = null;
  lastSavedAt: Date | null = null;

  constructor() {
    this.adapter = pickAdapter();
    let loaded: AppData | null = null;
    try {
      const raw = this.adapter.load();
      if (raw) loaded = migrate(raw, emptyData(todayISO()));
    } catch (e) {
      this.lastError = `Could not read saved data (${(e as Error).message}). Starting fresh — your old data was left untouched.`;
    }
    this.data = loaded ?? emptyData(todayISO());
  }

  get = () => this.data;

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** Apply a change to a deep copy, then persist and notify. */
  update = (fn: (draft: AppData) => void) => {
    const draft = structuredClone(this.data);
    fn(draft);
    this.replace(draft);
  };

  replace(next: AppData) {
    this.data = next;
    try {
      this.adapter.save(next);
      this.lastSavedAt = new Date();
      this.lastError = null;
    } catch (e) {
      this.lastError = `Saving failed: ${(e as Error).message}. Export a backup to be safe.`;
    }
    this.listeners.forEach((l) => l());
  }

  savePlan(plan: DayPlan) {
    this.update((d) => {
      d.plans[plan.date] = plan;
      // Keep the stored history bounded: plans older than 60 days are dropped.
      const cutoff = Object.keys(d.plans).sort().slice(0, -60);
      for (const k of cutoff) delete d.plans[k];
    });
  }

  loadDemo() {
    this.replace(demoData(todayISO()));
  }
  reset() {
    this.replace(emptyData(todayISO()));
  }
  importJSON(text: string) {
    const parsed = JSON.parse(text);
    this.replace(migrate(parsed, emptyData(todayISO())));
  }
  exportJSON() {
    return JSON.stringify({ ...this.data, exportedAt: new Date().toISOString() }, null, 2);
  }
}

export const store = new Store();

export function useApp(): AppData {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

export const update = store.update;
export type { ISODate };
