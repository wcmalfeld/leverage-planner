import { useEffect, useRef, useState } from 'react';
import type { Block } from '../../domain/types';
import { todayISO } from '../../domain/time';
import { dueNudges, nudgeText } from '../../engine/nudge';
import { store, useApp } from '../../store/store';
import { updateTask } from '../../store/actions';
import { minutesOf, toast, useNow } from './common';
import { Icon } from './icons';
import { useUI } from '../App';

const SENT_KEY = 'leverage-planner:nudged';

/** Blocks already nudged today, kept across reloads so a refresh doesn't repeat them. */
function loadSent(date: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(SENT_KEY) ?? 'null');
    if (raw?.date === date) return new Set(raw.ids);
  } catch { /* storage blocked */ }
  return new Set();
}
function saveSent(date: string, ids: Set<string>) {
  try { localStorage.setItem(SENT_KEY, JSON.stringify({ date, ids: [...ids] })); } catch { /* memory only */ }
}

export const canNotify = () => typeof Notification !== 'undefined';

/**
 * Watches today's plan and, when a block starts, shows what it is and the first step:
 * a banner in the app, plus a desktop notification when the tab is in the background.
 */
export function NudgeBanner() {
  const data = useApp();
  const now = useNow(15_000);
  const nowMin = minutesOf(now);
  const today = todayISO();
  const { openTask, go } = useUI();
  const sent = useRef<{ date: string; ids: Set<string> }>({ date: today, ids: loadSent(today) });
  const [active, setActive] = useState<Block | null>(null);
  const [step, setStep] = useState('');
  const [perm, setPerm] = useState(canNotify() ? Notification.permission : 'denied');
  const cfg = data.settings.nudges;

  useEffect(() => {
    if (!cfg?.enabled) return;
    if (sent.current.date !== today) sent.current = { date: today, ids: loadSent(today) };
    const plan = store.get().plans[today];
    if (!plan) return;
    const due = dueNudges(plan.blocks, nowMin, cfg.leadMin, sent.current.ids);
    if (!due.length) return;
    for (const b of due) sent.current.ids.add(b.id);
    saveSent(today, sent.current.ids);
    const b = due[due.length - 1];
    setActive(b);
    setStep('');
    if (canNotify() && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      const task = b.taskId ? store.get().tasks.find((t) => t.id === b.taskId) : undefined;
      const n = nudgeText(b, task, nowMin);
      try {
        const note = new Notification(n.title, { body: n.body, tag: b.id });
        note.onclick = () => { window.focus(); if (b.taskId) openTask(b.taskId); note.close(); };
      } catch { /* some browsers only allow notifications from a service worker */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowMin, today, cfg?.enabled, cfg?.leadMin, data.plans]);

  // The banner goes away once the block is over, done, or gone from the plan.
  const live = active && data.plans[today]?.blocks.find((b) => b.id === active.id);
  if (!live || nowMin >= live.end || live.status === 'done' || live.status === 'skipped') return null;
  const task = live.taskId ? data.tasks.find((t) => t.id === live.taskId) : undefined;
  const n = nudgeText(live, task, nowMin);
  const close = () => setActive(null);

  return (
    <div className="nudge" role="status" aria-live="polite">
      <Icon.spark />
      <div className="grow stack tight" style={{ minWidth: 0 }}>
        <span className="t">{n.title}</span>
        {n.step ? (
          <span className="small step"><strong>{n.label}:</strong> {n.step}</span>
        ) : task && (
          <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (!step.trim()) return; updateTask(task.id, { firstStep: step.trim() }); toast('First step saved'); }}>
            <input id="nudge-step" className="input grow" value={step} onChange={(e) => setStep(e.target.value)} placeholder="What’s the very first action? e.g. Open the doc and write the heading" aria-label="First step" />
            <button className="btn sm" disabled={!step.trim()}>Save</button>
          </form>
        )}
        <div className="row">
          {live.type === 'shutdown'
            ? <button className="btn sm primary" onClick={() => { go('review'); close(); }}>Start shutdown review</button>
            : <button className="btn sm primary" onClick={close}><Icon.check />Starting</button>}
          {task && <button className="btn sm ghost" onClick={() => openTask(task.id)}>Details</button>}
          <button className="btn sm ghost" onClick={close}>Dismiss</button>
          {perm === 'default' && (
            <button className="btn sm ghost" onClick={() => Notification.requestPermission().then(setPerm)}>Also notify me in the background</button>
          )}
        </div>
      </div>
    </div>
  );
}
