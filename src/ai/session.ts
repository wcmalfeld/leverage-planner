/**
 * In-memory coach session: the current chat and the latest Claude suggestions.
 * Survives switching views but not a reload — nothing here is persisted.
 */
import { useSyncExternalStore } from 'react';
import type { Suggestion } from '../engine/advisor';
import type { ChatMessage } from './coach';

interface CoachSession {
  chat: ChatMessage[];
  suggestions: Suggestion[] | null;
}

let current: CoachSession = { chat: [], suggestions: null };
const listeners = new Set<() => void>();

function set(next: Partial<CoachSession>) {
  current = { ...current, ...next };
  listeners.forEach((l) => l());
}

export const coachSession = {
  get: () => current,
  setChat: (chat: ChatMessage[]) => set({ chat }),
  setSuggestions: (suggestions: Suggestion[] | null) => set({ suggestions }),
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export const useCoachSession = () => useSyncExternalStore(coachSession.subscribe, coachSession.get);
