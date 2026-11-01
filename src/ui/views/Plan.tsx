import { useEffect, useState } from 'react';
import type { Block, ISODate } from '../../domain/types';
import { useApp, update } from '../../store/store';
import { useDerived } from '../../store/derived';
import { acceptAll, acceptBlock, completeTask, generateFor, rejectBlock, restoreRejected, setBlockTime, unlockBlock } from '../../store/actions';
import { addDays, fmtDateLong, fmtDuration, fmtTime, fromHHMM, todayISO, uid } from '../../domain/time';
import { TIER_INFO } from '../../engine/classify';
import { topReasons } from '../../engine/scoring';
import { Empty, GoalTag, Notice, TierChip, minutesOf, toast, useNow } from '../components/common';
import { Timeline, TimelineLegend } from '../components/Timeline';
import { Icon } from '../components/icons';
import { useUI } from '../App';

export function PlanView({ initialDate }: { initialDate?: ISODate }) {
  const data = useApp();
  const [date, setDate] = useState(initialDate ?? todayISO());
  const d = useDerived(date);
  const { openTask } = useUI();
  const [sel, setSel] = useState<string | undefined>();
  const now = useNow();
  const plan = d.plan;
  const tiers = new Map([...d.classes].map(([k, v]) => [k, v.tier]));
  const selected = plan?.blocks.find((b) => b.id === sel);

  useEffect(() => setSel(undefined), [date]);

  const onTimeChange = (b: Block, start: number, end: number) => {
    if (b.type === 'commitment') {
      update((dd) => {
        const p = dd.plans[date];
        const x = p?.blocks.find((y) => y.id === b.id);
        if (x) { x.start = start; x.end = end; x.locked = true; }
      });
      generateFor(date);
      toast(`Moved “${b.title}” for this day only`);
      return;
    }
    setBlockTime(date, b.id, start, end);
    setSel(b.id);
  };

  const [manual, setManual] = useState({ taskId: '', start: '09:00', minutes: '30' });
  const addManual = () => {
    const t = d.tasksById.get(manual.taskId);
    if (!t) return;
    const start = fromHHMM(manual.start);
    const end = start + (Number(manual.minutes) || 30);
    update((dd) => {
      const p = dd.plans[date];
      if (!p) return;
      p.rejectedTaskIds = p.rejectedTaskIds.filter((x) => x !== t.id);
      p.blocks.push({ id: uid('b'), date, start, end, title: t.title, type: 'task', taskId: t.id, goalIds: t.goalIds, status: 'accepted', fixed: false, locked: true });
      p.blocks.sort((a, b) => a.start - b.start);
    });
    toast('Added and locked in place');
    setManual({ ...manual, taskId: '' });
  };

  const isToday = date === todayISO();
  const proposed = plan?.blocks.filter((b) => b.type === 'task' && b.status === 'proposed').length ?? 0;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Daily plan</div>
          <h1>{fmtDateLong(date)}</h1>
          <p>Drag a block to move it, drag its lower edge to resize, or select it for more options. Anything you touch is locked and survives regeneration. Keyboard: arrows move by 5 min (Shift = 30), Alt + arrows resize.</p>
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">←</button>
          <input id="plan-date" type="date" className="input" style={{ width: 'auto' }} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Plan date" />
          <button className="btn ghost sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">→</button>
          {!isToday && <button className="btn sm" onClick={() => setDate(todayISO())}>Today</button>}
        </div>
      </header>

      <div className="row">
        <button className="btn primary" onClick={() => { generateFor(date); toast(plan ? 'Regenerated — locked blocks kept' : 'Plan generated'); }}>
          <Icon.refresh />{plan ? 'Regenerate (keep my edits)' : 'Generate plan'}
        </button>
        {plan && <button className="btn" onClick={() => { generateFor(date, false); toast('Fresh plan — edits and rejections cleared'); }}>Start fresh</button>}
        {proposed > 0 && <button className="btn" onClick={() => { acceptAll(date); toast(`Accepted ${proposed} blocks`); }}><Icon.check />Accept all ({proposed})</button>}
        {d.stale && <span className="chip warn">Inputs changed since this plan was made</span>}
      </div>

      {!plan ? (
        <div className="panel"><Empty title="No plan for this day yet">The engine will fit your highest-leverage tasks around your routine, energy and open-time preferences.<button className="btn primary" onClick={() => generateFor(date)}>Generate plan</button></Empty></div>
      ) : (
        <div className="plan-layout">
          <section className="panel stack">
            <div className="row between">
              <span className="small muted mono">
                {fmtDuration(plan.stats.freeMin)} flexible · {fmtDuration(plan.stats.plannedTaskMin)} planned · {fmtDuration(plan.stats.slackMin)} open
              </span>
              <TimelineLegend />
            </div>
            <Timeline blocks={plan.blocks} settings={data.settings} goals={data.goals} tiers={tiers} editable selectedId={sel}
              nowMin={isToday ? minutesOf(now) : undefined} onSelect={(b) => setSel(b.id)} onTimeChange={onTimeChange} pxPerMin={1.1} />
          </section>

          <aside className="side-sticky">
            {selected ? <BlockPanel block={selected} date={date} onClose={() => setSel(undefined)} openTask={openTask} /> : (
              <div className="panel small muted">Select a block to accept, swap, remove or log it.</div>
            )}

            {plan.conflicts.length > 0 && (
              <section className="stack tight">
                {plan.conflicts.map((c, i) => (
                  <Notice key={i} kind={c.severity === 'info' ? 'info' : c.severity === 'warning' ? 'warn' : 'crit'}>
                    <strong>{c.message}</strong>
                    <ul>{c.suggestions.map((s, j) => <li key={j}>{s}</li>)}</ul>
                  </Notice>
                ))}
              </section>
            )}

            <section className="panel">
              <div className="panel-head"><h3>Didn’t make today’s plan</h3><span className="xs muted">{plan.unscheduled.length}</span></div>
              {plan.unscheduled.length === 0 ? <p className="small muted">Every eligible task fit.</p> : (
                <div className="list">
                  {plan.unscheduled.slice(0, 10).map((u) => {
                    const t = d.tasksById.get(u.taskId);
                    if (!t) return null;
                    return (
                      <div key={u.taskId} className="item clickable" onClick={() => openTask(t.id)}>
                        <div className="grow">
                          <div className="row nowrap"><span className="item-title grow">{t.title}</span>{u.important && <span className="chip warn">Important</span>}</div>
                          <div className="xs muted">{u.reason}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {plan.rejectedTaskIds.length > 0 && (
              <section className="panel">
                <div className="panel-head"><h3>Removed from this day</h3></div>
                <div className="list">
                  {plan.rejectedTaskIds.map((id) => {
                    const t = d.tasksById.get(id);
                    return t ? (
                      <div key={id} className="item"><span className="grow small">{t.title}</span><button className="btn sm ghost" onClick={() => restoreRejected(date, id)}>Restore</button></div>
                    ) : null;
                  })}
                </div>
              </section>
            )}

            <section className="panel stack tight">
              <h3>Place a task by hand</h3>
              <select id="man-task" className="input" value={manual.taskId} onChange={(e) => { const t = d.tasksById.get(e.target.value); setManual({ ...manual, taskId: e.target.value, minutes: String(t?.durationMin ?? 30) }); }} aria-label="Task">
                <option value="">Choose a task…</option>
                {d.ranked.filter((r) => !plan.blocks.some((b) => b.taskId === r.task.id)).map((r) => <option key={r.task.id} value={r.task.id}>{r.task.title}</option>)}
              </select>
              <div className="row nowrap">
                <input id="man-start" type="time" className="input" value={manual.start} onChange={(e) => setManual({ ...manual, start: e.target.value })} aria-label="Start" />
                <input id="man-min" className="input" inputMode="numeric" value={manual.minutes} onChange={(e) => setManual({ ...manual, minutes: e.target.value.replace(/\D/g, '') })} aria-label="Minutes" />
                <button className="btn" disabled={!manual.taskId} onClick={addManual}>Add</button>
              </div>
            </section>
          </aside>
        </div>
      )}
    </>
  );
}

function BlockPanel({ block: b, date, onClose, openTask }: { block: Block; date: string; onClose: () => void; openTask: (id: string) => void }) {
  const data = useApp();
  const d = useDerived(date);
  const goal = data.goals.find((g) => g.id === b.goalIds[0]);
  const r = b.taskId ? d.rankedById.get(b.taskId) : undefined;
  const cls = b.taskId ? d.classes.get(b.taskId) : undefined;

  return (
    <section className="panel stack tight">
      <div className="row between nowrap">
        <span className="eyebrow">{b.type === 'task' ? (b.status === 'proposed' ? 'Proposed' : b.status) : b.fixed ? 'Fixed commitment' : 'Movable commitment'}</span>
        <button className="iconbtn" onClick={onClose} aria-label="Close"><Icon.x /></button>
      </div>
      <h3>{b.title}</h3>
      <div className="row">
        <span className="mono small">{fmtTime(b.start)}–{fmtTime(b.end)} · {fmtDuration(b.end - b.start)}</span>
        {goal && <GoalTag goal={goal} />}
      </div>
      {b.type === 'task' && b.taskId && (
        <>
          {cls && <div className="row"><TierChip tier={cls.tier} /><span className="xs muted">{TIER_INFO[cls.tier].advice}</span></div>}
          {r && <p className="small">{topReasons(r.result).map((f) => f.note).join('; ') || 'Best available use of this slot'}.</p>}
          {b.note && <p className="xs muted">{b.note}</p>}
          <div className="row">
            {b.status === 'proposed' && <button className="btn sm primary" onClick={() => acceptBlock(date, b.id)}><Icon.check />Accept</button>}
            {b.locked && b.status !== 'done' && <button className="btn sm" onClick={() => unlockBlock(date, b.id)}>Unlock</button>}
            {b.status !== 'done' && <button className="btn sm" onClick={() => { rejectBlock(date, b.id); onClose(); toast('Swapped for the next best task'); }} title="Remove from this day and fill the gap"><Icon.swap />Swap</button>}
            {b.status !== 'done' && <button className="btn sm ghost" onClick={() => { rejectBlock(date, b.id, false); onClose(); toast('Removed from this day — task kept'); }}>Remove</button>}
          </div>
          <div className="row">
            {b.status !== 'done' && <button className="btn sm" onClick={() => { completeTask(b.taskId!, date, b.end - b.start); toast('Logged as done'); }}>Mark done ({fmtDuration(b.end - b.start)})</button>}
            <button className="btn sm ghost" onClick={() => openTask(b.taskId!)}>Open task</button>
          </div>
        </>
      )}
      {b.type === 'commitment' && (
        <p className="small muted">{b.fixed ? 'Fixed commitments never move automatically. Edit them in Routine.' : 'Drag to move it for this day only. The routine itself stays the same.'}</p>
      )}
    </section>
  );
}
