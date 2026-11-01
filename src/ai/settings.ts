/**
 * AI coach connection. Stored apart from AppData on purpose: the API key never
 * goes into backups or exports, and nothing is sent until the user consents.
 */
import { useSyncExternalStore } from 'react';

export interface AISettings {
  apiKey: string;
  consent: boolean;
}

const KEY = 'leverage-planner:ai';
const listeners = new Set<() => void>();

function load(): AISettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { apiKey: '', consent: false, ...JSON.parse(raw) };
  } catch { /* storage blocked or corrupt */ }
  return { apiKey: '', consent: false };
}

let current = load();

export const aiSettings = {
  get: () => current,
  set(next: Partial<AISettings>) {
    current = { ...current, ...next };
    try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* memory only */ }
    listeners.forEach((l) => l());
  },
  clear() {
    current = { apiKey: '', consent: false };
    try { localStorage.removeItem(KEY); } catch { /* nothing to remove */ }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useAISettings = () => useSyncExternalStore(aiSettings.subscribe, aiSettings.get);
export const aiReady = (s: AISettings) => s.consent && s.apiKey.trim().length > 0;
