import { useMemo, useRef, useState } from 'react';
import type { Task } from '../../domain/types';
import { useApp } from '../../store/store';
import { useRanking } from '../../store/derived';
import { addTask, updateTask } from '../../store/actions';
import { daysBetween, fmtDuration, todayISO } from '../../domain/time';
import { ruleSuggestions } from '../../engine/advisor';
import { Empty, GoalTag, TierChip, toast } from '../components/common';
import { Icon } from '../components/icons';
import { useUI } from '../App';

type Filter = 'open' | 'inbox' | 'completed' | 'deferred' | 'all';

export function TasksView() {
  const data = useApp();
  const today = todayISO();
  const { rankedById, classes } = useRanking(today);
  const { openTask, go } = useUI();
  const [title, setTitle] = useState('');
  const [goalId, setGoalId] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [goalFilter, setGoalFilter] = useState('');
  const [hidden, setHidden] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const goals = [...data.goals].sort((a, b) => a.order - b.order);
  const goalsById = new Map(goals.map((g) => [g.id, g]));

  const list = useMemo(() => {
    const match = (t: Task) =>
      (filter === 'all' ||
        (filter === 'open' && t.status !== 'completed' && t.status !== 'deferred') ||
        t.status === filter) &&
      (!goalFilter || (goalFilter === '_none' ? t.goalIds.length === 0 : t.goalIds.includes(goalFilter)));
    return data.tasks.filter(match).sort((a, b) => {
      const ra = rankedById.get(a.id), rb = rankedById.get(b.id);
      if (ra && rb) return ra.rank - rb.rank;
      if (ra) return -1;
      if (rb) return 1;
      return (b.completedAt ?? '').localeCompare(a.completedAt ?? '');
    });
  }, [data.tasks, filter, goalFilter, rankedById]);

  const suggestions = useMemo(() => ruleSuggestions(data, today).filter((s) => !hidden.includes(s.id)).slice(0, 6), [data, today, hidden]);

  const capture = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    addTask({ title: t, goalIds: goalId ? [goalId] : [] });
    setTitle('');
    toast('Captured — clarify it when you have a minute');
    inputRef.current?.focus();
  };

  const counts = {
    open: data.tasks.filter((t) => t.status !== 'completed' && t.status !== 'deferred').length,
    inbox: data.tasks.filter((t) => t.status === 'inbox').length,
    completed: data.tasks.filter((t) => t.status === 'completed').length,
    deferred: data.tasks.filter((t) => t.status === 'deferred').length,
    all: data.tasks.length,
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Task & opportunity inbox</div>
          <h1>Capture anything. Clarify later.</h1>
          <p>Only the title is required. The more you fill in later — goal, expected result, duration — the better the ranking gets.</p>
        </div>
      </header>

      <form className="capture" onSubmit={capture}>
        <input id="capture" ref={inputRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Apply to…, call…, build…, ride…" aria-label="New task" />
        <select id="capture-goal" className="input" style={{ width: 'auto', maxWidth: '40%', border: 0 }} value={goalId} onChange={(e) => setGoalId(e.target.value)} aria-label="Goal">
          <option value="">No goal yet</option>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <button className="btn primary" disabled={!title.trim()}><Icon.plus />Add</button>
      </form>

      <div className="plan-layout">
        <section className="panel">
          <div className="row between" style={{ marginBottom: '.6rem' }}>
            <div className="seg" role="group" aria-label="Status filter">
              {(['open', 'inbox', 'completed', 'deferred', 'all'] as Filter[]).map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)} <span className="mono faint">{counts[f]}</span></button>
              ))}
            </div>
            <select id="goal-filter" className="input" style={{ width: 'auto' }} value={goalFilter} onChange={(e) => setGoalFilter(e.target.value)} aria-label="Goal filter">
              <option value="">All goals</option>
              {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="_none">No goal</option>
            </select>
          </div>
          {list.length === 0 ? <Empty title={filter === 'inbox' ? 'Inbox zero' : 'Nothing here'}>{filter === 'open' ? 'Capture your first task above.' : 'Try another filter.'}</Empty> : (
            <div className="list">
              {list.map((t) => {
                const r = rankedById.get(t.id);
                const c = classes.get(t.id);
                const due = t.deadline ? daysBetween(today, t.deadline) : undefined;
                return (
                  <div key={t.id} className="item clickable" onClick={() => openTask(t.id)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && openTask(t.id)}>
                    <span className="mono small" style={{ width: '2.2em', textAlign: 'right', color: r?.result.blocked ? 'var(--faint)' : undefined }}>{r ? Math.round(r.result.score) : '—'}</span>
                    <div className="grow">
                      <div className="item-title" style={t.status === 'completed' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{t.title}</div>
                      <div className="row xs muted">
                        {t.goalIds.length ? t.goalIds.map((g) => <GoalTag key={g} goal={goalsById.get(g)} />) : <span className="faint">No goal</span>}
                        {t.durationMin && <span className="mono">{fmtDuration(t.durationMin)}</span>}
                        {due !== undefined && <span className={due <= 1 ? 'chip crit' : due <= 3 ? 'chip warn' : 'mono'}>{due < 0 ? `${-due}d overdue` : due === 0 ? 'Due today' : `Due in ${due}d`}</span>}
                        {t.recurrence !== 'none' && <span>↻ {t.recurrence}</span>}
                        {r?.result.blocked && <span className="chip">Blocked</span>}
                        {t.status === 'inbox' && <span className="chip warn">Needs clarifying</span>}
                        {c?.busywork && <span className="chip crit">Busywork?</span>}
                      </div>
                    </div>
                    {c && t.status !== 'completed' && <TierChip tier={c.tier} />}
                    {t.status !== 'completed' && t.status !== 'deferred' && (
                      <button className="iconbtn" title="Defer" aria-label={`Defer ${t.title}`} onClick={(e) => { e.stopPropagation(); updateTask(t.id, { status: 'deferred' }); toast('Deferred'); }}><Icon.down /></button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="side-sticky">
          <section className="panel">
            <div className="panel-head">
              <h2>What am I missing?</h2>
              <span className="xs faint">Built-in rules · offline</span>
            </div>
            {suggestions.length === 0 ? <p className="small muted">No gaps spotted right now.</p> : (
              <div className="list">
                {suggestions.map((s) => (
                  <div key={s.id} className="item" style={{ flexDirection: 'column', gap: '.35rem', alignItems: 'stretch' }}>
                    <div className="row nowrap between"><span className="item-title">{s.title}</span>{s.goalId && <GoalTag goal={goalsById.get(s.goalId)} />}</div>
                    <span className="small muted">{s.detail}</span>
                    <div className="row">
                      {s.draft && <button className="btn sm" onClick={() => { const id = addTask({ ...s.draft, title: s.draft!.title! }); toast('Added to your tasks'); openTask(id); }}><Icon.plus />Add as task</button>}
                      {(s.kind === 'clarify' || s.kind === 'breakdown') && s.taskId && <button className="btn sm" onClick={() => openTask(s.taskId!)}>Open</button>}
                      {(s.kind === 'neglected' || s.kind === 'bottleneck' || s.kind === 'milestone') && !s.draft && <button className="btn sm" onClick={() => go('goals')}>Review goal</button>}
                      <button className="btn sm ghost" onClick={() => setHidden([...hidden, s.id])}>Dismiss</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="xs faint" style={{ marginTop: '.6rem' }}>An AI strategy coach can plug in here later. It will only see your data after you explicitly connect a provider.</p>
          </section>
        </aside>
      </div>
    </>
  );
}
