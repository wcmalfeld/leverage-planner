import { createContext, lazy, Suspense, useContext, useEffect, useState, type ReactNode } from 'react';
import { useApp, store } from '../store/store';
import { BrandMark, Icon } from './components/icons';
import { Notice, ToastHost } from './components/common';
import { TaskDrawer } from './components/TaskDrawer';
import { TodayView } from './views/Today';
import { PlanView } from './views/Plan';
import { CompareView } from './views/Compare';
import { TasksView } from './views/Tasks';
import { PrioritiesView } from './views/Priorities';
import { GoalsView } from './views/Goals';
import { RoutineView } from './views/Routine';
import { ReviewView } from './views/Review';
import { DataView } from './views/Data';
import { CalendarView } from './views/Calendar';
import type { ISODate } from '../domain/types';
import { todayISO } from '../domain/time';
import { Onboarding } from './views/Onboarding';

// Loaded on demand so the Anthropic SDK only downloads for people who use the coach.
const CoachView = lazy(() => import('./views/Coach').then((m) => ({ default: m.CoachView })));

export type View = 'today' | 'plan' | 'calendar' | 'compare' | 'coach' | 'tasks' | 'priorities' | 'goals' | 'routine' | 'review' | 'data';

const NAV: { id: View; label: string; icon: () => ReactNode }[] = [
  { id: 'today', label: 'Today', icon: Icon.today },
  { id: 'plan', label: 'Plan', icon: Icon.plan },
  { id: 'calendar', label: 'Calendar', icon: Icon.calendar },
  { id: 'compare', label: 'Compare', icon: Icon.compare },
  { id: 'coach', label: 'Coach', icon: Icon.spark },
  { id: 'tasks', label: 'Tasks', icon: Icon.tasks },
  { id: 'priorities', label: 'Priorities', icon: Icon.rank },
  { id: 'goals', label: 'Goals', icon: Icon.goals },
  { id: 'routine', label: 'Routine', icon: Icon.routine },
  { id: 'review', label: 'Review', icon: Icon.review },
  { id: 'data', label: 'Data', icon: Icon.data },
];

interface UI {
  go: (v: View) => void;
  openTask: (id: string) => void;
  openPlan: (date: ISODate) => void;
}
const UICtx = createContext<UI>({ go: () => {}, openTask: () => {}, openPlan: () => {} });
export const useUI = () => useContext(UICtx);

const readHash = (): View => {
  const h = location.hash.replace('#', '') as View;
  return NAV.some((n) => n.id === h) ? h : 'today';
};

export function App() {
  const data = useApp();
  const [view, setView] = useState<View>(readHash);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState<ISODate>(todayISO);
  const [onboarding, setOnboarding] = useState(!data.onboarded);

  useEffect(() => {
    const f = () => setView(readHash());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const go = (v: View, date: ISODate = todayISO()) => {
    if (v === 'plan') setPlanDate(date);
    setView(v);
    try { history.replaceState(null, '', `#${v}`); } catch { /* sandboxed */ }
    window.scrollTo({ top: 0 });
  };

  const inbox = data.tasks.filter((t) => t.status === 'inbox').length;

  const page = {
    today: <TodayView />,
    plan: <PlanView key={planDate} initialDate={planDate} />,
    calendar: <CalendarView />,
    compare: <CompareView />,
    coach: <CoachView />,
    tasks: <TasksView />,
    priorities: <PrioritiesView />,
    goals: <GoalsView />,
    routine: <RoutineView />,
    review: <ReviewView />,
    data: <DataView onRestartOnboarding={() => setOnboarding(true)} />,
  }[view];

  return (
    <UICtx.Provider value={{ go, openTask: setTaskId, openPlan: (date) => go('plan', date) }}>
      <div className="shell">
        <nav className="rail" aria-label="Main">
          <div className="brand">
            <BrandMark />
            <div>
              <div className="brand-name">Leverage</div>
              <div className="brand-sub">Personal strategy engine</div>
            </div>
          </div>
          <div className="nav">
            {NAV.map((n) => (
              <button key={n.id} aria-current={view === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
                <n.icon />
                <span>{n.label}</span>
                {n.id === 'tasks' && inbox > 0 && <span className="count">{inbox}</span>}
              </button>
            ))}
          </div>
          <div className="rail-foot">
            {store.adapter.durable ? 'Saved on this device only' : 'Not saving — export a backup'}
          </div>
        </nav>
        <main className="main">
          <div className="page">
            {store.lastError && <Notice kind="warn">{store.lastError}</Notice>}
            {!store.adapter.durable && (
              <Notice kind="warn">This browser is blocking storage, so changes last only until you close the tab. Use Data → Export to keep a copy.</Notice>
            )}
            <Suspense fallback={<p className="small muted">Loading…</p>}>{page}</Suspense>
          </div>
        </main>
      </div>
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />}
      {onboarding && <Onboarding onDone={() => { setOnboarding(false); go('today'); }} />}
      <ToastHost />
    </UICtx.Provider>
  );
}
