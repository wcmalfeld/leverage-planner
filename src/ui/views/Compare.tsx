import { useEffect, useState } from 'react';
import type { Block, CurrentBlock, CurrentValue } from '../../domain/types';
import { useApp } from '../../store/store';
import { useDerived } from '../../store/derived';
import { deleteCurrent, generateFor, upsertCurrent } from '../../store/actions';
import { DAY_NAMES, addDays, dayOfWeek, fmtDateLong, fmtDuration, fmtTime, fromHHMM, toHHMM, todayISO, uid } from '../../domain/time';
import { ConfirmButton, Empty, Field, GoalTag, goalColor, toast } from '../components/common';
import { Timeline, currentToBlocks } from '../components/Timeline';
import { Icon } from '../components/icons';
import { useUI } from '../App';

const VALUE_LABEL: Record<CurrentValue, string> = { essential: 'Essential', high: 'High value', maintenance: 'Maintenance', low: 'Low value', distraction: 'Distraction' };

export function CompareView() {
  const data = useApp();
  const [date, setDate] = useState(todayISO());
  const d = useDerived(date);
  const { openTask, go } = useUI();
  const [editing, setEditing] = useState<CurrentBlock | null>(null);

  useEffect(() => {
    if (!data.plans[date]) generateFor(date);
  }, [date, data.plans]);

  const cmp = d.comparison;
  const commitmentBlocks: Block[] = (d.plan?.blocks ?? []).filter((b) => b.type === 'commitment' || b.type === 'travel');
  const currentBlocks = cmp ? [...commitmentBlocks, ...currentToBlocks(cmp.current, date)] : [];
  const maxAlloc = Math.max(60, ...(cmp?.allocation.flatMap((r) => [r.current, r.recommended]) ?? [0]));
  const tiers = new Map([...d.classes].map(([k, v]) => [k, v.tier]));

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Current vs recommended</div>
          <h1>{fmtDateLong(date)}</h1>
          <p>Left is what you expect to do anyway, from your typical week. Right is how the engine would use the same flexible time. Commitments appear on both sides.</p>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">←</button>
          <input id="cmp-date" type="date" className="input" style={{ width: 'auto' }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Date" />
          <button className="btn ghost sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">→</button>
        </div>
      </header>

      {cmp && cmp.headline.length > 0 && (
        <section className="band stack tight">
          {cmp.headline.map((h, i) => <p key={i} style={i === 0 ? { fontFamily: 'var(--f-display)', fontSize: '1.15rem', fontWeight: 600 } : undefined}>{h}</p>)}
        </section>
      )}

      <div className="grid2">
        <section className="panel">
          <div className="panel-head"><h2>Highest-value changes</h2></div>
          {!cmp || cmp.changes.length === 0 ? <p className="small muted">No changes suggested — your current plan already matches the recommendation.</p> : (
            <div className="list">
              {cmp.changes.slice(0, 8).map((c, i) => (
                <div key={i} className="change">
                  <span className={`kind ${c.kind}`}>{c.kind}</span>
                  <div className="grow"><div className="item-title">{c.title}</div><div className="small muted">{c.detail}</div></div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head"><h2>Your three highest-leverage actions</h2></div>
            <ol className="stack tight" style={{ margin: 0, paddingLeft: '1.2rem' }}>
              {d.top.map((a) => (
                <li key={a.task.id}>
                  <button className="btn ghost sm" style={{ padding: 0, fontWeight: 700, color: 'var(--fg)', whiteSpace: 'normal', textAlign: 'left' }} onClick={() => openTask(a.task.id)}>{a.task.title}</button>
                  <div className="small muted">{a.why}. <strong style={{ color: 'var(--fg)' }}>Done when:</strong> {a.success}</div>
                </li>
              ))}
            </ol>
          </section>
          <section className="panel">
            <div className="panel-head"><h2>Stop or postpone to make room</h2></div>
            {d.stop.length === 0 ? <p className="small muted">Nothing to cut — add your typical week below to find it.</p> : (
              <ul className="stack tight" style={{ margin: 0, paddingLeft: '1.1rem' }}>
                {d.stop.map((s, i) => <li key={i}><strong>{s.title}</strong> <span className="small muted">— {s.reason}</span></li>)}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Time by goal</h2>
          <div className="legend"><span><i style={{ background: 'var(--faint)', opacity: .55 }} />Current</span><span><i style={{ background: 'var(--accent)' }} />Recommended</span></div>
        </div>
        {cmp && (
          <div className="alloc">
            {cmp.allocation.filter((r) => r.current || r.recommended || r.key !== '_none').map((r) => {
              const delta = r.recommended - r.current;
              const goal = data.goals.find((g) => g.id === r.key);
              return [
                <span key={r.key + 'l'} style={{ minWidth: 0 }}>{goal ? <GoalTag goal={goal} /> : <span className="small muted">{r.label}</span>}</span>,
                <div key={r.key + 'b'} className="bars">
                  <div className="bar cur" style={{ width: `${(r.current / maxAlloc) * 100}%` }} title={`Current ${fmtDuration(r.current)}`} />
                  <div className="bar" style={{ width: `${(r.recommended / maxAlloc) * 100}%`, background: goal ? goalColor(goal) : 'var(--faint)' }} title={`Recommended ${fmtDuration(r.recommended)}`} />
                </div>,
                <span key={r.key + 'd'} className={`delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>{delta === 0 ? '—' : `${delta > 0 ? '+' : '−'}${fmtDuration(Math.abs(delta))}`}</span>,
              ];
            })}
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <div className="panel-head"><h2>Missing from your current plan</h2></div>
          {!cmp?.missing.length ? <p className="small muted">Nothing high-leverage is missing.</p> : (
            <div className="list">
              {cmp.missing.map((m) => (
                <div key={m.taskId} className="item clickable" onClick={() => openTask(m.taskId)}>
                  <span className="mono small" style={{ width: '2.4em' }}>{Math.round(m.score)}</span>
                  <div className="grow"><div className="item-title">{m.title}</div><GoalTag goal={data.goals.find((g) => g.id === m.goalId)} /></div>
                  <span className="mono small muted">{fmtDuration(m.minutes)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-head"><h2>Low-value time today</h2></div>
          {!cmp?.lowValue.length ? <p className="small muted">No low-value blocks in your current plan for this day.</p> : (
            <div className="list">
              {cmp.lowValue.map((l) => (
                <div key={l.block.id} className="item">
                  <div className="grow"><div className="item-title">{l.block.title}</div><div className="small muted">{l.reason}</div></div>
                  <span className="mono small">{fmtTime(l.block.start)} · {fmtDuration(l.minutes)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="compare-cols">
        <section className="panel">
          <div className="panel-head"><h2>A · Current plan</h2><button className="btn sm" onClick={() => setEditing(blank(date))}><Icon.plus />Add block</button></div>
          {cmp && cmp.current.length === 0 && <p className="small muted" style={{ marginBottom: '.75rem' }}>Nothing entered for {DAY_NAMES[dayOfWeek(date)]}s. Add what you’d realistically do — including the scrolling.</p>}
          <Timeline blocks={currentBlocks} settings={data.settings} goals={data.goals} pxPerMin={0.7} showFocus={false} label="Current plan"
            onSelect={(b) => { const c = data.currentPlan.find((x) => x.id === b.id); if (c) setEditing(c); }} />
        </section>
        <section className="panel">
          <div className="panel-head"><h2>B · Recommended</h2><button className="btn sm ghost" onClick={() => go('plan')}>Edit plan</button></div>
          {d.plan ? <Timeline blocks={d.plan.blocks} settings={data.settings} goals={data.goals} tiers={tiers} pxPerMin={0.7} label="Recommended plan" onSelect={(b) => b.taskId && openTask(b.taskId)} /> : <Empty title="Generating…" />}
        </section>
      </div>

      <CurrentPlanList onEdit={setEditing} />
      {editing && <CurrentEditor value={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const blank = (date: string): CurrentBlock => ({ id: uid('cp'), title: '', days: [dayOfWeek(date)], start: 9 * 60, end: 10 * 60 });

function CurrentPlanList({ onEdit }: { onEdit: (c: CurrentBlock) => void }) {
  const data = useApp();
  const items = [...data.currentPlan].sort((a, b) => a.start - b.start);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Your typical week</h2>
        <span className="small muted">This is the “current plan”. Calendar import can feed this list later.</span>
      </div>
      {items.length === 0 ? <Empty title="No routine entered">Add the blocks you normally do — work, study, errands, phone time — so the comparison has something real to compare against.</Empty> : (
        <div className="list">
          {items.map((c) => (
            <div key={c.id} className="item clickable" onClick={() => onEdit(c)}>
              <span className="mono small" style={{ width: '8.5em' }}>{fmtTime(c.start)}–{fmtTime(c.end)}</span>
              <div className="grow">
                <div className="item-title">{c.title}</div>
                <div className="row xs muted">{c.date ? c.date : c.days.map((x) => DAY_NAMES[x]).join(' ')}{c.goalId && <GoalTag goal={data.goals.find((g) => g.id === c.goalId)} />}</div>
              </div>
              {c.value && <span className={`chip ${c.value === 'distraction' ? 'crit' : c.value === 'low' ? 'warn' : ''}`}>{VALUE_LABEL[c.value]}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CurrentEditor({ value, onClose }: { value: CurrentBlock; onClose: () => void }) {
  const data = useApp();
  const [c, setC] = useState(value);
  const [oneOff, setOneOff] = useState(!!value.date);
  const valid = c.title.trim() && c.end > c.start && (oneOff ? !!c.date : c.days.length > 0);
  const exists = data.currentPlan.some((x) => x.id === c.id);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Current plan block">
        <div className="stack" style={{ padding: '1.25rem' }}>
          <h2>{exists ? 'Edit block' : 'Add to current plan'}</h2>
          <Field label="What"><input id="ce-title" className="input" autoFocus value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} placeholder="e.g. Email + job boards" /></Field>
          <div className="fields">
            <Field label="Start"><input id="ce-start" type="time" className="input" value={toHHMM(c.start)} onChange={(e) => setC({ ...c, start: fromHHMM(e.target.value) })} /></Field>
            <Field label="End"><input id="ce-end" type="time" className={`input ${c.end <= c.start ? 'invalid' : ''}`} value={toHHMM(c.end)} onChange={(e) => setC({ ...c, end: fromHHMM(e.target.value) })} /></Field>
          </div>
          <div className="row">
            <label className="check"><input type="radio" name="ce-rep" checked={!oneOff} onChange={() => { setOneOff(false); setC({ ...c, date: undefined }); }} />Typical week</label>
            <label className="check"><input type="radio" name="ce-rep" checked={oneOff} onChange={() => { setOneOff(true); setC({ ...c, date: c.date ?? todayISO() }); }} />One day</label>
          </div>
          {oneOff ? <Field label="Date"><input id="ce-date" type="date" className="input" value={c.date ?? ''} onChange={(e) => setC({ ...c, date: e.target.value })} /></Field> : (
            <div className="days" role="group" aria-label="Days">
              {DAY_NAMES.map((n, i) => <button key={n} type="button" aria-pressed={c.days.includes(i)} onClick={() => setC({ ...c, days: c.days.includes(i) ? c.days.filter((x) => x !== i) : [...c.days, i].sort() })}>{n}</button>)}
            </div>
          )}
          <div className="fields">
            <Field label="Goal it serves">
              <select id="ce-goal" className="input" value={c.goalId ?? ''} onChange={(e) => setC({ ...c, goalId: e.target.value || undefined })}>
                <option value="">None</option>
                {data.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="Honest value">
              <select id="ce-val" className="input" value={c.value ?? ''} onChange={(e) => setC({ ...c, value: (e.target.value || undefined) as CurrentValue | undefined })}>
                <option value="">Let the engine judge</option>
                {(Object.keys(VALUE_LABEL) as CurrentValue[]).map((v) => <option key={v} value={v}>{VALUE_LABEL[v]}</option>)}
              </select>
            </Field>
          </div>
          <div className="row between">
            {exists ? <ConfirmButton label="Delete" onConfirm={() => { deleteCurrent(c.id); onClose(); }} /> : <span />}
            <div className="row">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!valid} onClick={() => { upsertCurrent({ ...c, title: c.title.trim() }); toast('Current plan updated'); onClose(); }}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
