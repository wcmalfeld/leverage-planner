import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { useDerived } from '../../store/derived';
import { completeTask, generateFor, logActual } from '../../store/actions';
import { addDays, fmtDateLong, fmtDuration, fmtTime, todayISO } from '../../domain/time';
import { goalWeight } from '../../engine/scoring';
import { minutesByGoal } from '../../engine/review';
import { Empty, GoalTag, Notice, TierChip, goalColor, minutesOf, toast, useNow } from '../components/common';
import { Timeline } from '../components/Timeline';
import { Icon } from '../components/icons';
import { useUI } from '../App';

export function TodayView() {
  const data = useApp();
  const today = todayISO();
  const d = useDerived(today);
  const { go, openTask } = useUI();
  const now = useNow();
  const nowMin = minutesOf(now);

  useEffect(() => {
    if (!data.plans[today] && data.onboarded) generateFor(today);
  }, [today, data.onboarded, data.plans]);

  const goalsById = useMemo(() => new Map(data.goals.map((g) => [g.id, g])), [data.goals]);
  const plan = d.plan;
  const blocks = plan?.blocks ?? [];
  const current = blocks.find((b) => (b.type === 'task' || b.type === 'commitment') && b.start <= nowMin && b.end > nowMin);
  const nextTask = blocks.find((b) => b.type === 'task' && b.start >= nowMin && b.status !== 'done' && b.id !== current?.id);
  const upcoming = blocks.filter((b) => b.type === 'commitment' && b.start >= nowMin).slice(0, 3);
  const tiers = new Map([...d.classes].map(([k, v]) => [k, v.tier]));
  const remainingFree = blocks.filter((b) => b.type === 'task' && b.start >= nowMin).reduce((s, b) => s + b.end - b.start, 0);

  const unscheduledImportant = (plan?.unscheduled ?? []).filter((u) => u.important);

  // Am I spending time in line with my priorities? Plan vs priority share vs last 7 days.
  const alignment = useMemo(() => {
    const active = data.goals.filter((g) => g.status === 'active').sort((a, b) => a.order - b.order);
    const wSum = active.reduce((s, g) => s + goalWeight(g, data.goals), 0) || 1;
    const planned: Record<string, number> = {};
    for (const b of blocks) if (b.type === 'task') planned[b.goalIds[0] ?? '_'] = (planned[b.goalIds[0] ?? '_'] ?? 0) + b.end - b.start;
    const pTotal = Object.values(planned).reduce((a, b) => a + b, 0) || 1;
    const week = minutesByGoal(data.actuals, data.tasks, addDays(today, -7), addDays(today, -1));
    const wTotal = Object.values(week).reduce((a, b) => a + b, 0) || 1;
    return active.map((g) => ({ g, fair: goalWeight(g, data.goals) / wSum, plan: (planned[g.id] ?? 0) / pTotal, week: (week[g.id] ?? 0) / wTotal }));
  }, [data, blocks, today]);

  const [log, setLog] = useState({ taskId: '', minutes: '' });

  if (!data.onboarded) return null;

  return (
    <>
      <section className="band hero">
        <div className="stack">
          <div>
            <div className="eyebrow">Today</div>
            <div className="hero-date">{fmtDateLong(today)}</div>
          </div>
          <div className="stats">
            <div className="stat"><div className="v">{fmtDuration(plan?.stats.freeMin ?? 0)}</div><div className="k">Flexible time</div></div>
            <div className="stat"><div className="v">{fmtDuration(plan?.stats.plannedTaskMin ?? 0)}</div><div className="k">Planned work</div></div>
            <div className="stat"><div className="v">{fmtDuration(plan?.stats.slackMin ?? 0)}</div><div className="k">Kept open</div></div>
            <div className="stat"><div className="v">{fmtDuration(remainingFree)}</div><div className="k">Work left today</div></div>
          </div>
          <p style={{ maxWidth: '62ch' }}>{d.note}</p>
          <div className="row">
            <button className="btn primary" onClick={() => go('plan')}><Icon.plan />Adjust today’s plan</button>
            <button className="btn" onClick={() => go('compare')}><Icon.compare />Compare with my current plan</button>
            <button className="btn ghost" onClick={() => go('review')}>End-of-day review</button>
          </div>
        </div>
        <div className="stack">
          {current ? (
            <div className={`now-card ${current.type === 'task' ? 'active' : ''}`}>
              <span className="label">Now · until {fmtTime(current.end)}</span>
              <span className="t">{current.title}</span>
              <div className="progress"><i style={{ width: `${Math.min(100, ((nowMin - current.start) / (current.end - current.start)) * 100)}%` }} /></div>
              {current.taskId && current.status !== 'done' && (
                <div className="row">
                  <button className="btn sm primary" onClick={() => { completeTask(current.taskId!, today, nowMin - current.start || current.end - current.start); toast('Logged as done'); }}><Icon.check />Done</button>
                  <button className="btn sm" onClick={() => openTask(current.taskId!)}>Details</button>
                </div>
              )}
            </div>
          ) : (
            <div className="now-card">
              <span className="label">Now</span>
              <span className="t">{nowMin < data.settings.wake ? 'Before your day starts' : nowMin >= data.settings.sleep ? 'Day is done — rest' : 'Open time'}</span>
              <span className="small muted">Nothing is scheduled right now.</span>
            </div>
          )}
          <div className="now-card">
            <span className="label">Next action</span>
            {nextTask ? (
              <>
                <span className="t">{nextTask.title}</span>
                <span className="small muted mono">{fmtTime(nextTask.start)}–{fmtTime(nextTask.end)}</span>
              </>
            ) : <span className="small muted">Nothing else planned today.</span>}
            {upcoming.length > 0 && (
              <div className="stack tight" style={{ marginTop: '.3rem' }}>
                <span className="label">Coming up</span>
                {upcoming.map((u) => <span key={u.id} className="small"><span className="mono muted">{fmtTime(u.start)}</span> {u.title}</span>)}
              </div>
            )}
          </div>
        </div>
      </section>

      {d.stale && (
        <Notice kind="info">
          <div className="row between">
            <span>Your tasks or routine changed since this plan was made.</span>
            <button className="btn sm primary" onClick={() => { generateFor(today); toast('Plan refreshed — your edits were kept'); }}><Icon.refresh />Refresh plan</button>
          </div>
        </Notice>
      )}

      <section className="stack">
        <h2>Your three highest-leverage actions today</h2>
        {d.top.length === 0 ? (
          <div className="panel"><Empty title="No ranked tasks yet">Capture a few tasks and link them to your goals — the ranking appears here.<button className="btn primary" onClick={() => go('tasks')}>Add tasks</button></Empty></div>
        ) : (
          <div className="top3">
            {d.top.map((a, i) => (
              <article key={a.task.id} className="action">
                <div className="row between">
                  <span className="rank">{i + 1} · score {Math.round(a.ranked.result.score)}</span>
                  {d.classes.get(a.task.id) && <TierChip tier={d.classes.get(a.task.id)!.tier} />}
                </div>
                <h3>{a.task.title}</h3>
                <div className="row">
                  <GoalTag goal={a.goal} />
                  {a.block ? <span className="xs mono muted">{fmtTime(a.block.start)}–{fmtTime(a.block.end)}</span> : <span className="xs chip warn">Not scheduled</span>}
                </div>
                <dl>
                  <div><dt>Why it matters</dt><dd>{a.why}.</dd></div>
                  <div><dt>Success looks like</dt><dd>{a.success}</dd></div>
                  {a.edge && <div><dt>Why this over others</dt><dd className="muted">{a.edge}</dd></div>}
                </dl>
                <div className="row" style={{ marginTop: 'auto' }}>
                  <button className="btn sm" onClick={() => { completeTask(a.task.id, today, a.task.durationMin); toast('Logged as done'); }}><Icon.check />Done</button>
                  <button className="btn sm ghost" onClick={() => openTask(a.task.id)}>Explain & edit</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head">
            <h2>Recommended schedule</h2>
            <button className="btn sm ghost" onClick={() => go('plan')}>Edit</button>
          </div>
          {plan ? (
            <Timeline blocks={blocks} settings={data.settings} goals={data.goals} tiers={tiers} nowMin={nowMin} pxPerMin={0.75}
              onSelect={(b) => (b.taskId ? openTask(b.taskId) : go('plan'))} />
          ) : <Empty title="No plan yet"><button className="btn primary" onClick={() => generateFor(today)}>Generate today’s plan</button></Empty>}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>Stop or postpone today</h2></div>
            {d.stop.length === 0 ? <p className="muted small">Nothing low-value is competing for today. Add your current routine in Compare to see what to cut.</p> : (
              <div className="list">
                {d.stop.map((s, i) => (
                  <div key={i} className="item">
                    <span className={`chip ${s.kind === 'current' ? 'crit' : s.kind === 'busywork' ? 'warn' : ''}`}>{s.kind === 'current' ? 'Cut' : s.kind === 'busywork' ? 'Busywork' : 'Postpone'}</span>
                    <div className="grow"><div className="item-title">{s.title}</div><div className="small muted">{s.reason}</div></div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Important, not scheduled</h2></div>
            {unscheduledImportant.length === 0 ? <p className="muted small">Everything important fits today.</p> : (
              <div className="list">
                {unscheduledImportant.map((u) => {
                  const t = d.tasksById.get(u.taskId);
                  return t ? (
                    <div key={u.taskId} className="item clickable" onClick={() => openTask(t.id)}>
                      <div className="grow"><div className="item-title">{t.title}</div><div className="small muted">{u.reason}</div></div>
                      <GoalTag goal={goalsById.get(t.goalIds[0])} />
                    </div>
                  ) : null;
                })}
              </div>
            )}
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Is my time going where I want?</h2></div>
            <div className="stack tight">
              <div className="row xs muted"><span style={{ width: 120 }} /><span className="grow">Priority share · today’s plan · last 7 days</span></div>
              {alignment.map(({ g, fair, plan: p, week }) => (
                <div key={g.id} className="row nowrap small">
                  <span style={{ width: 120, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                  <div className="grow stack" style={{ gap: 2 }}>
                    <div className="meter"><i style={{ width: `${fair * 100}%`, background: 'var(--line)', outline: '1px solid var(--faint)' }} /></div>
                    <div className="meter"><i style={{ width: `${p * 100}%`, background: goalColor(g) }} /></div>
                    <div className="meter"><i style={{ width: `${week * 100}%`, background: goalColor(g), opacity: 0.45 }} /></div>
                  </div>
                </div>
              ))}
              <p className="xs faint">Top bar: the share your goal ratings imply. Middle: today’s plan. Bottom: what you actually logged this past week.</p>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>Log progress</h2></div>
            <form className="row" onSubmit={(e) => {
              e.preventDefault();
              const t = d.tasksById.get(log.taskId);
              const m = Number(log.minutes);
              if (!t || !m) return;
              logActual({ date: today, title: t.title, minutes: m, taskId: t.id });
              setLog({ taskId: '', minutes: '' });
              toast(`Logged ${fmtDuration(m)} on “${t.title}”`);
            }}>
              <select id="log-task" className="input grow" value={log.taskId} onChange={(e) => setLog({ ...log, taskId: e.target.value })} aria-label="Task">
                <option value="">Which task?</option>
                {d.ranked.map((r) => <option key={r.task.id} value={r.task.id}>{r.task.title}</option>)}
              </select>
              <input id="log-min" className="input" style={{ width: 90 }} inputMode="numeric" placeholder="min" value={log.minutes} onChange={(e) => setLog({ ...log, minutes: e.target.value.replace(/\D/g, '') })} aria-label="Minutes" />
              <button className="btn" disabled={!log.taskId || !log.minutes}>Log</button>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
