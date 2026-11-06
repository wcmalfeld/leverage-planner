import { useMemo, useState } from 'react';
import type { Rating } from '../../domain/types';
import { useApp } from '../../store/store';
import { generateFor, saveDailyReview, saveWeeklyReview, type PickUp, type ReviewRow } from '../../store/actions';
import { addDays, fmtDateLong, fmtDateShort, fmtDuration, todayISO, weekStart } from '../../domain/time';
import { goalTrend, planVsActual, weeklySummary } from '../../engine/review';
import { scorecard } from '../../engine/alignment';
import { ScorecardPanel } from '../components/Scorecard';
import { Empty, Field, GoalTag, RatingInput, Seg, goalColor, toast } from '../components/common';
import { Icon } from '../components/icons';
import { useUI } from '../App';

type Tab = 'daily' | 'weekly' | 'trends';

export function ReviewView() {
  const [tab, setTab] = useState<Tab>('daily');
  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Review</div>
          <h1>Close the loop</h1>
          <p>Your end-of-day shutdown. In one field study, 15 minutes of end-of-day reflection lifted performance by about 23%. Giving each unfinished task a next step and a day lets you stop thinking about it tonight. Actual durations also recalibrate your estimates.</p>
        </div>
        <Seg<Tab> label="Review type" value={tab} onChange={setTab} options={[{ v: 'daily', l: 'Shutdown' }, { v: 'weekly', l: 'This week' }, { v: 'trends', l: 'Progress over time' }]} />
      </header>
      {tab === 'daily' && <Daily />}
      {tab === 'weekly' && <Weekly />}
      {tab === 'trends' && <Trends />}
    </>
  );
}

function Daily() {
  const data = useApp();
  const [date, setDate] = useState(todayISO());
  return <DailyForm key={date} date={date} setDate={setDate} saved={data.dailyReviews[date]} />;
}

function DailyForm({ date, setDate, saved }: { date: string; setDate: (d: string) => void; saved?: ReturnType<typeof useApp>['dailyReviews'][string] }) {
  const data = useApp();
  const plan = data.plans[date];
  const tasksById = new Map(data.tasks.map((t) => [t.id, t]));
  const initialRows = useMemo<ReviewRow[]>(() => {
    const ids: string[] = [];
    for (const b of plan?.blocks ?? []) if (b.type === 'task' && b.taskId && !ids.includes(b.taskId)) ids.push(b.taskId);
    for (const t of data.tasks) if ((t.completedAt === date || t.lastDoneOn === date) && !ids.includes(t.id)) ids.push(t.id);
    for (const a of data.actuals) if (a.date === date && a.taskId && !ids.includes(a.taskId)) ids.push(a.taskId);
    return ids.filter((id) => tasksById.has(id)).map((id) => {
      const t = tasksById.get(id)!;
      const logged = data.actuals.filter((a) => a.date === date && a.taskId === id).reduce((s, a) => s + a.minutes, 0);
      const planned = (plan?.blocks ?? []).filter((b) => b.taskId === id).reduce((s, b) => s + b.end - b.start, 0);
      const done = t.completedAt === date || t.lastDoneOn === date || !!saved?.completedTaskIds.includes(id);
      const pickUp: PickUp = t.status === 'deferred' ? 'someday' : t.plannedFor && t.plannedFor > date ? t.plannedFor : 'auto';
      return { taskId: id, done, minutes: logged || (done ? planned || t.durationMin || 0 : 0), outcome: t.outcome, resume: t.resumeNote?.text ?? '', pickUp };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);
  const [rows, setRows] = useState<ReviewRow[]>(initialRows);
  const [distractions, setDistractions] = useState(() => {
    const x = data.actuals.filter((a) => a.date === date && a.distraction).map((a) => ({ title: a.title, minutes: a.minutes }));
    return x.length ? x : [{ title: '', minutes: 0 }];
  });
  const [text, setText] = useState({ learned: saved?.learned ?? '', outcomes: saved?.outcomes ?? '', obstacles: saved?.obstacles ?? '', changes: saved?.changes ?? '' });
  const { openPlan } = useUI();
  const tomorrow = addDays(date, 1);
  const [energy, setEnergy] = useState<Rating | undefined>(saved?.energy);
  const [extra, setExtra] = useState('');
  const pva = planVsActual(plan, data.tasks, data.actuals, date);
  const doneCount = rows.filter((r) => r.done).length;
  const setRow = (i: number, p: Partial<ReviewRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));

  return (
    <div className="plan-layout">
      <section className="panel stack">
        <div className="row between">
          <h2>{fmtDateLong(date)}</h2>
          <div className="row">
            <button className="btn ghost sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">←</button>
            <button className="btn ghost sm" disabled={date >= todayISO()} onClick={() => setDate(addDays(date, 1))} aria-label="Next day">→</button>
          </div>
        </div>
        {saved && <span className="chip ok" style={{ alignSelf: 'flex-start' }}>Saved {new Date(saved.savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} — saving again updates it</span>}

        <div className="stack tight">
          <h3>What got done?</h3>
          {rows.length === 0 && <p className="small muted">Nothing was planned for this day. Add anything you worked on below.</p>}
          {rows.map((r, i) => {
            const t = tasksById.get(r.taskId)!;
            return (
              <div key={r.taskId} className="row nowrap" style={{ alignItems: 'flex-start', padding: '.4rem 0', borderTop: i ? '1px solid var(--line)' : undefined }}>
                <input type="checkbox" checked={r.done} onChange={(e) => setRow(i, { done: e.target.checked, minutes: e.target.checked && !r.minutes ? t.durationMin ?? 30 : r.minutes })} aria-label={`Done: ${t.title}`} style={{ accentColor: 'var(--accent)', width: 18, height: 18, marginTop: 6 }} />
                <div className="grow stack" style={{ gap: 4 }}>
                  <span className="item-title" style={r.done ? undefined : { color: 'var(--muted)' }}>{t.title}</span>
                  {r.done && <input id={`rv-out-${r.taskId}`} className="input" placeholder="Outcome (optional): what did it produce?" value={r.outcome ?? ''} onChange={(e) => setRow(i, { outcome: e.target.value })} />}
                  {!r.done && (
                    <>
                      <input id={`rv-res-${r.taskId}`} className="input" placeholder="Where did you stop / what’s the next step?" value={r.resume ?? ''} onChange={(e) => setRow(i, { resume: e.target.value })} aria-label={`Next step for ${t.title}`} />
                      <div className="row nowrap xs">
                        <span className="muted">Pick it up</span>
                        <select id={`rv-pick-${r.taskId}`} className="input" style={{ width: 'auto' }} aria-label={`When to pick up ${t.title}`}
                          value={r.pickUp === 'auto' || r.pickUp === 'someday' || r.pickUp === tomorrow ? r.pickUp : 'date'}
                          onChange={(e) => setRow(i, { pickUp: e.target.value === 'date' ? addDays(date, 2) : (e.target.value as PickUp) })}>
                          <option value={tomorrow}>Tomorrow</option>
                          <option value="date">On a specific day…</option>
                          <option value="auto">Whenever it ranks highest</option>
                          <option value="someday">Someday (out of plans)</option>
                        </select>
                        {r.pickUp && r.pickUp !== 'auto' && r.pickUp !== 'someday' && r.pickUp !== tomorrow && (
                          <input id={`rv-pickd-${r.taskId}`} type="date" className="input" style={{ width: 'auto' }} min={tomorrow} value={r.pickUp} onChange={(e) => e.target.value && setRow(i, { pickUp: e.target.value })} aria-label="Pick-up date" />
                        )}
                      </div>
                    </>
                  )}
                </div>
                <input id={`rv-min-${r.taskId}`} className="input" style={{ width: 76 }} inputMode="numeric" value={r.minutes || ''} placeholder="min" onChange={(e) => setRow(i, { minutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} aria-label={`Minutes on ${t.title}`} />
              </div>
            );
          })}
          <div className="row nowrap">
            <select id="rv-extra" className="input grow" value={extra} onChange={(e) => setExtra(e.target.value)} aria-label="Add unplanned work">
              <option value="">Also worked on…</option>
              {data.tasks.filter((t) => t.status !== 'completed' && !rows.some((r) => r.taskId === t.id)).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <button className="btn sm" disabled={!extra} onClick={() => { setRows([...rows, { taskId: extra, done: false, minutes: 30 }]); setExtra(''); }}>Add</button>
          </div>
        </div>

        <div className="stack tight">
          <h3>Where did time leak?</h3>
          {distractions.map((x, i) => (
            <div key={i} className="row nowrap">
              <input id={`rv-d-${i}`} className="input grow" placeholder="e.g. Phone, news, YouTube" value={x.title} onChange={(e) => setDistractions(distractions.map((y, j) => (j === i ? { ...y, title: e.target.value } : y)))} aria-label="Distraction" />
              <input id={`rv-dm-${i}`} className="input" style={{ width: 76 }} inputMode="numeric" placeholder="min" value={x.minutes || ''} onChange={(e) => setDistractions(distractions.map((y, j) => (j === i ? { ...y, minutes: Number(e.target.value.replace(/\D/g, '')) || 0 } : y)))} aria-label="Minutes" />
            </div>
          ))}
          <div><button className="btn sm ghost" onClick={() => setDistractions([...distractions, { title: '', minutes: 0 }])}><Icon.plus />Another</button></div>
        </div>

        <Field label="What did you learn today?" hint="A sentence or two: about the work, how you worked, or what to do differently."><textarea id="rv-learned" className="input" value={text.learned} onChange={(e) => setText({ ...text, learned: e.target.value })} placeholder="e.g. Calls go better when I send the agenda first. I underestimated the résumé edits by half." /></Field>
        <Field label="Meaningful outcomes"><textarea id="rv-outcomes" className="input" value={text.outcomes} onChange={(e) => setText({ ...text, outcomes: e.target.value })} placeholder="A reply, a booked call, a shipped feature…" /></Field>
        <Field label="Unexpected obstacles"><textarea id="rv-obst" className="input" value={text.obstacles} onChange={(e) => setText({ ...text, obstacles: e.target.value })} /></Field>
        <Field label="Have priorities or circumstances changed?"><textarea id="rv-changes" className="input" value={text.changes} onChange={(e) => setText({ ...text, changes: e.target.value })} /></Field>
        <Field label="Energy today"><RatingInput label="Energy" value={energy} onChange={setEnergy} /></Field>

        <div className="row">
          <button className="btn primary" onClick={() => {
            saveDailyReview({ date, ...text, energy }, rows, distractions);
            generateFor(tomorrow);
            toast('Saved — here’s tomorrow’s plan');
            openPlan(tomorrow);
          }}><Icon.check />Save & plan tomorrow</button>
          <button className="btn" onClick={() => {
            saveDailyReview({ date, ...text, energy }, rows, distractions);
            toast(doneCount ? `Saved — ${doneCount} done. The rest rolls forward.` : 'Saved. Tomorrow is a fresh plan.');
          }}>Save only</button>
          <span className="small muted">{doneCount} of {rows.length} done. Unchecked tasks keep their next step and pick-up day.</span>
        </div>
      </section>

      <aside className="side-sticky">
        <section className="panel stack tight">
          <h3>Planned vs actual</h3>
          {pva.plannedTasks === 0 && pva.actualMin === 0 ? <p className="small muted">No plan or logged time for this day yet.</p> : (
            <>
              <div className="stats">
                <div className="stat"><div className="v">{pva.completedTasks}/{pva.plannedTasks}</div><div className="k">Planned tasks done</div></div>
                <div className="stat"><div className="v">{fmtDuration(pva.actualMin)}</div><div className="k">Logged of {fmtDuration(pva.plannedMin)}</div></div>
              </div>
              <div className="list">
                {pva.rows.map((r) => (
                  <div key={r.taskId} className="item small">
                    <span className={`chip ${r.done ? 'ok' : ''}`}>{r.done ? 'Done' : 'Open'}</span>
                    <span className="grow">{r.title}</span>
                    <span className="mono xs muted">{fmtDuration(r.actual)} / {fmtDuration(r.planned)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <p className="xs faint">Logged time comes from what you save here plus quick logs on Today.</p>
        </section>
      </aside>
    </div>
  );
}

function Weekly() {
  const data = useApp();
  const [ws, setWs] = useState(weekStart(todayISO()));
  const s = useMemo(() => weeklySummary(data, ws), [data, ws]);
  const card = useMemo(() => scorecard(data, ws, addDays(ws, 6)), [data, ws]);
  const saved = data.weeklyReviews[ws];
  const [notes, setNotes] = useState({ notes: saved?.notes ?? '', nextWeekFocus: saved?.nextWeekFocus ?? '' });
  const { openTask, go } = useUI();
  const totalMin = s.byGoal.reduce((a, b) => a + b.minutes, 0);

  return (
    <div className="stack loose">
      <div className="row between">
        <h2>Week of {fmtDateShort(s.weekStart)} – {fmtDateShort(s.weekEnd)}</h2>
        <div className="row">
          <button className="btn ghost sm" onClick={() => { setWs(addDays(ws, -7)); }} aria-label="Previous week">←</button>
          <button className="btn ghost sm" disabled={ws >= weekStart(todayISO())} onClick={() => setWs(addDays(ws, 7))} aria-label="Next week">→</button>
        </div>
      </div>

      <div className="band stats">
        <div className="stat"><div className="v">{fmtDuration(totalMin)}</div><div className="k">Toward goals</div></div>
        <div className="stat"><div className="v">{fmtDuration(s.distractionMin)}</div><div className="k">Logged distraction</div></div>
        <div className="stat"><div className="v">{s.byGoal.reduce((a, b) => a + b.completed, 0)}</div><div className="k">Tasks completed</div></div>
        <div className="stat"><div className="v">{s.completionRate === null ? '—' : `${Math.round(s.completionRate * 100)}%`}</div><div className="k">Reviewed tasks done</div></div>
        <div className="stat"><div className="v">{s.bottleneckChanged ? 'Changed' : 'Same'}</div><div className="k">Bottleneck</div></div>
      </div>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head"><h3>Recommendations for next week</h3></div>
          <ul className="stack tight" style={{ margin: 0, paddingLeft: '1.1rem' }}>{s.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {s.bottleneckChanged ? null : <p className="small muted" style={{ marginTop: '.6rem' }}>Is “{data.bottleneck.statement || 'no bottleneck set'}” still the constraint? <button className="btn ghost sm" onClick={() => go('goals')}>Revisit</button></p>}
        </section>
        <ScorecardPanel card={card} />
      </div>

      <div className="grid3">
        <section className="panel">
          <div className="panel-head"><h3>Highest-impact outcomes</h3></div>
          {s.outcomes.length === 0 ? <p className="small muted">No completed high-impact tasks logged this week.</p> : (
            <div className="list">{s.outcomes.map(({ task }) => <div key={task.id} className="item small"><div className="grow"><strong>{task.title}</strong>{task.outcome && <div className="muted">{task.outcome}</div>}</div></div>)}</div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Repeated distractions</h3></div>
          {s.distractions.length === 0 ? <p className="small muted">None logged.</p> : (
            <div className="list">{s.distractions.map((x) => <div key={x.title} className="item small"><span className="grow">{x.title}</span><span className="mono">{fmtDuration(x.minutes)}</span></div>)}</div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Repeatedly postponed</h3></div>
          {s.postponed.length === 0 ? <p className="small muted">Nothing is stuck.</p> : (
            <div className="list">{s.postponed.map((t) => <div key={t.id} className="item small clickable" onClick={() => openTask(t.id)}><span className="grow">{t.title}</span><span className="chip warn">{t.postponeCount}×</span></div>)}</div>
          )}
        </section>
      </div>

      <section className="panel stack">
        <h3>Your notes</h3>
        <Field label="What did this week teach you?"><textarea id="wk-notes" className="input" value={notes.notes} onChange={(e) => setNotes({ ...notes, notes: e.target.value })} /></Field>
        <Field label="Next week’s focus"><input id="wk-focus" className="input" value={notes.nextWeekFocus} onChange={(e) => setNotes({ ...notes, nextWeekFocus: e.target.value })} placeholder="One sentence" /></Field>
        <div><button className="btn primary" onClick={() => { saveWeeklyReview({ weekStart: ws, ...notes }); toast('Weekly review saved'); }}>Save weekly review</button></div>
      </section>
    </div>
  );
}

function Trends() {
  const data = useApp();
  const today = todayISO();
  const weeks = goalTrend(data, today, 28);
  const goals = data.goals.filter((g) => g.status === 'active').sort((a, b) => a.order - b.order);
  const maxWeek = Math.max(60, ...weeks.map((w) => Object.values(w.byGoal).reduce((a, b) => a + b, 0)));
  if (!data.actuals.length) return <div className="panel"><Empty title="No history yet">Save a daily review or log time on Today, and progress shows up here.</Empty></div>;
  return (
    <div className="grid2">
      <section className="panel stack">
        <h3>Logged time per week, last 4 weeks</h3>
        <div className="row nowrap" style={{ alignItems: 'flex-end', gap: '1rem', height: 160 }}>
          {weeks.map((w) => {
            const total = Object.values(w.byGoal).reduce((a, b) => a + b, 0);
            return (
              <div key={w.weekStart} className="stack tight" style={{ flex: 1, alignItems: 'stretch', height: '100%', justifyContent: 'flex-end' }}>
                <span className="mono xs" style={{ textAlign: 'center' }}>{fmtDuration(total)}</span>
                <div style={{ height: `${(total / maxWeek) * 110}px`, display: 'flex', flexDirection: 'column-reverse', borderRadius: 4, overflow: 'hidden', background: 'var(--sunken)', minHeight: 2 }}>
                  {goals.map((g) => w.byGoal[g.id] ? <div key={g.id} style={{ height: `${(w.byGoal[g.id] / total) * 100}%`, background: goalColor(g) }} title={`${g.name}: ${fmtDuration(w.byGoal[g.id])}`} /> : null)}
                  {w.byGoal['_none'] ? <div style={{ height: `${(w.byGoal['_none'] / total) * 100}%`, background: 'var(--faint)' }} title="No goal" /> : null}
                </div>
                <span className="xs muted" style={{ textAlign: 'center' }}>{fmtDateShort(w.weekStart)}</span>
              </div>
            );
          })}
        </div>
        <div className="legend">{goals.map((g) => <span key={g.id}><i style={{ background: goalColor(g) }} />{g.name}</span>)}</div>
      </section>
      <section className="panel stack">
        <h3>Goal progress</h3>
        {goals.map((g) => {
          const done = data.tasks.filter((t) => t.status === 'completed' && t.goalIds.includes(g.id)).length;
          const p = g.metric && g.metric.target ? Math.min(1, g.metric.current / g.metric.target) : null;
          return (
            <div key={g.id} className="stack" style={{ gap: 3 }}>
              <div className="row between small"><GoalTag goal={g} /><span className="mono xs muted">{done} done · {g.milestones.filter((m) => m.done).length}/{g.milestones.length} milestones</span></div>
              {p !== null && <div className="row nowrap xs"><div className="meter grow"><i style={{ width: `${p * 100}%`, background: goalColor(g) }} /></div><span className="mono">{g.metric!.current}/{g.metric!.target} {g.metric!.unit}</span></div>}
            </div>
          );
        })}
      </section>
    </div>
  );
}
