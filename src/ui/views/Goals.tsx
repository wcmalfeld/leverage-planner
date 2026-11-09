import { useState } from 'react';
import type { Goal, GoalHorizon, GoalStatus } from '../../domain/types';
import { useApp } from '../../store/store';
import { addGoal, addMilestone, addTask, deleteGoal, deleteMilestone, moveGoal, setBottleneck, updateGoal, updateMilestone } from '../../store/actions';
import { todayISO } from '../../domain/time';
import { detectBottleneck } from '../../engine/advisor';
import { isOpen } from '../../engine/scoring';
import { goalTargets, stalledGoals, STALL_LABEL, type Stall } from '../../engine/alignment';
import { GOAL_COLORS } from '../../store/seed';
import { ConfirmButton, Field, RatingInput, goalColor, toast } from '../components/common';
import { Icon } from '../components/icons';
import { useUI } from '../App';

export const HORIZON_LABEL: Record<GoalHorizon, string> = { vision: 'Long-term vision', annual: 'Annual goal', quarter: '90-day objective', week: 'Weekly priority' };

export function GoalsView() {
  const data = useApp();
  const goals = [...data.goals].sort((a, b) => a.order - b.order);
  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const { freshStart } = useUI();
  const stalls = new Map(stalledGoals(data, todayISO()).map((s) => [s.goal.id, s]));

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Goals & priorities</div>
          <h1>The life you’re building</h1>
          <p>Order and importance drive alignment scores. Health and relationships can be marked as <em>sustaining</em>: protected and scheduled consistently rather than maximised.</p>
        </div>
        <button className="btn" onClick={() => freshStart('goals')}><Icon.refresh />New goals, clean slate</button>
      </header>

      <BottleneckCard />

      <section className="panel">
        <div className="panel-head"><h2>Goals</h2><span className="xs muted">Top of the list = highest priority</span></div>
        <div className="list">
          {goals.map((g, i) => (
            <GoalRow key={g.id} goal={g} stall={stalls.get(g.id)} first={i === 0} last={i === goals.length - 1} open={openId === g.id} onToggle={() => setOpenId(openId === g.id ? null : g.id)} />
          ))}
        </div>
        <form className="row" style={{ marginTop: '.75rem' }} onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; const id = addGoal(newName.trim()); setNewName(''); setOpenId(id); }}>
          <input id="new-goal" className="input grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add a goal…" aria-label="New goal name" />
          <button className="btn" disabled={!newName.trim()}><Icon.plus />Add goal</button>
        </form>
      </section>
    </>
  );
}

function BottleneckCard() {
  const data = useApp();
  const [statement, setStatement] = useState(data.bottleneck.statement);
  const [ids, setIds] = useState(data.bottleneck.goalIds);
  const [editing, setEditing] = useState(!data.bottleneck.statement);
  const candidates = detectBottleneck(data, todayISO()).slice(0, 3);
  const active = data.goals.filter((g) => g.status === 'active').sort((a, b) => a.order - b.order);

  return (
    <section className="bottleneck stack">
      <div className="row between">
        <span className="eyebrow" style={{ color: 'var(--glow)' }}>Current bottleneck</span>
        {!editing && <button className="btn sm" onClick={() => setEditing(true)}>Edit</button>}
      </div>
      {editing ? (
        <div className="stack tight">
          <Field label="What single constraint, if resolved, would unlock the most progress?">
            <input id="bn-statement" className="input" value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="e.g. No reliable income — financial pressure limits every other choice" />
          </Field>
          <div className="row">
            <span className="xs muted">Goals it involves:</span>
            {active.map((g) => (
              <label key={g.id} className="check small"><input type="checkbox" checked={ids.includes(g.id)} onChange={(e) => setIds(e.target.checked ? [...ids, g.id] : ids.filter((x) => x !== g.id))} />{g.name}</label>
            ))}
          </div>
          <div className="row">
            <button className="btn primary sm" onClick={() => { setBottleneck(statement, ids); setEditing(false); toast('Bottleneck updated — rankings adjusted'); }}>Save</button>
            {data.bottleneck.statement && <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </div>
      ) : (
        <>
          <p className="statement">{data.bottleneck.statement}</p>
          <p className="small muted">Tasks marked “attacks my bottleneck” get the full bottleneck boost; other tasks in {data.bottleneck.goalIds.map((id) => data.goals.find((g) => g.id === id)?.name).filter(Boolean).join(', ') || 'these goals'} get half.</p>
        </>
      )}
      {candidates.length > 0 && (
        <details>
          <summary className="small" style={{ color: 'var(--glow)', fontWeight: 700 }}>What the engine sees ▾</summary>
          <div className="stack tight" style={{ marginTop: '.5rem' }}>
            {candidates.map((c) => (
              <div key={c.goal.id} className="row nowrap small">
                <span className="mono" style={{ width: '2.5em' }}>{Math.round(c.score * 100)}</span>
                <span className="grow"><strong>{c.goal.name}</strong> <span className="muted">— {c.reasons.join('; ') || 'important, little momentum'}</span></span>
              </div>
            ))}
            <p className="xs muted">Heuristic: importance × distance from target × recent neglect, plus stuck or blocking tasks. You decide.</p>
          </div>
        </details>
      )}
      {data.bottleneck.history.length > 1 && <p className="xs muted">Previously: “{data.bottleneck.history.at(-2)!.statement}” ({data.bottleneck.history.at(-2)!.date})</p>}
    </section>
  );
}

function GoalRow({ goal: g, stall, first, last, open, onToggle }: { goal: Goal; stall?: Stall; first: boolean; last: boolean; open: boolean; onToggle: () => void }) {
  const data = useApp();
  const { openTask } = useUI();
  const set = (p: Partial<Goal>) => updateGoal(g.id, p);
  const tasks = data.tasks.filter((t) => t.goalIds.includes(g.id) && isOpen(t));
  const [ms, setMs] = useState({ title: '', horizon: 'quarter' as GoalHorizon, dueDate: '' });
  const [next, setNext] = useState('');
  const target = goalTargets(data.goals).get(g.id);
  const progress = g.metric && g.metric.target > 0 ? Math.min(1, g.metric.current / g.metric.target) : undefined;

  return (
    <div className="goal-row" style={{ opacity: g.status === 'active' ? 1 : 0.6 }}>
      <div className="stack" style={{ gap: 2, alignItems: 'center' }}>
        <button className="iconbtn" disabled={first} onClick={() => moveGoal(g.id, -1)} aria-label={`Move ${g.name} up`}><Icon.up /></button>
        <span className="goal-swatch" style={{ background: goalColor(g) }} />
        <button className="iconbtn" disabled={last} onClick={() => moveGoal(g.id, 1)} aria-label={`Move ${g.name} down`}><Icon.down /></button>
      </div>
      <div className="stack tight" style={{ minWidth: 0 }}>
        <button onClick={onToggle} aria-expanded={open} style={{ border: 0, background: 'none', padding: 0, textAlign: 'left', cursor: 'pointer' }}>
          <h3>{g.name}</h3>
          <p className="small muted">{g.outcome || 'Describe the outcome you want…'}</p>
        </button>
        <div className="row xs muted">
          <span>{HORIZON_LABEL[g.horizon]}</span>
          {g.targetDate && <span className="mono">by {g.targetDate}</span>}
          {g.status !== 'active' && <span className="chip">{g.status}</span>}
          {g.sustaining && <span className="chip ok">Sustaining</span>}
          <span>{tasks.length} open task{tasks.length === 1 ? '' : 's'}</span>
          {target && <span title="Share of your goal time this goal should get">Target {Math.round(target.share * 100)}%{target.explicit ? '' : ' (implied)'}</span>}
          {stall && <span className={`chip ${stall.reason === 'not-scheduled' ? '' : 'warn'}`} title={stall.detail}>{STALL_LABEL[stall.reason]}</span>}
          {g.milestones.length > 0 && <span>{g.milestones.filter((m) => m.done).length}/{g.milestones.length} milestones</span>}
        </div>
        {progress !== undefined && (
          <div className="row nowrap xs">
            <div className="meter grow"><i style={{ width: `${progress * 100}%`, background: goalColor(g) }} /></div>
            <span className="mono">{g.metric!.current}/{g.metric!.target} {g.metric!.unit ?? ''}</span>
          </div>
        )}

        {open && (
          <div className="stack" style={{ marginTop: '.5rem' }}>
            <div className="fields">
              <Field label="Name"><input id={`g-name-${g.id}`} className="input" value={g.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Horizon">
                <select id={`g-hor-${g.id}`} className="input" value={g.horizon} onChange={(e) => set({ horizon: e.target.value as GoalHorizon })}>
                  {(Object.keys(HORIZON_LABEL) as GoalHorizon[]).map((h) => <option key={h} value={h}>{HORIZON_LABEL[h]}</option>)}
                </select>
              </Field>
              <Field label="Target date"><input id={`g-date-${g.id}`} type="date" className="input" value={g.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || undefined })} /></Field>
              <Field label="Status">
                <select id={`g-st-${g.id}`} className="input" value={g.status} onChange={(e) => set({ status: e.target.value as GoalStatus })}>
                  <option value="active">Active</option><option value="paused">Paused</option><option value="achieved">Achieved</option><option value="dropped">Dropped</option>
                </select>
              </Field>
            </div>
            <Field label="Target share of goal time (%)" hint={`What part of the time you spend on goals should go here. Blank = implied by importance and order${target && !target.explicit ? ` (now ${Math.round(target.share * 100)}%)` : ''}. Compared with actual time on Today and in Review.`}>
              <input id={`g-target-${g.id}`} className="input" style={{ maxWidth: 120 }} inputMode="numeric" placeholder={target ? String(Math.round(target.share * 100)) : ''} value={g.targetShare ?? ''}
                onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); set({ targetShare: v ? Math.min(100, Number(v)) : undefined }); }} />
            </Field>
            <Field label="Desired outcome"><textarea id={`g-out-${g.id}`} className="input" value={g.outcome} onChange={(e) => set({ outcome: e.target.value })} /></Field>
            <Field label="Why it matters"><textarea id={`g-why-${g.id}`} className="input" value={g.why} onChange={(e) => set({ why: e.target.value })} /></Field>
            <div className="fields">
              <Field label="Progress measure"><input id={`g-ml-${g.id}`} className="input" placeholder="e.g. Paying clients" value={g.metric?.label ?? ''} onChange={(e) => set({ metric: e.target.value ? { current: 0, target: 1, ...g.metric, label: e.target.value } : undefined })} /></Field>
              {g.metric && <>
                <Field label="Current"><input id={`g-mc-${g.id}`} className="input" inputMode="decimal" value={g.metric.current} onChange={(e) => set({ metric: { ...g.metric!, current: Number(e.target.value) || 0 } })} /></Field>
                <Field label="Target"><input id={`g-mt-${g.id}`} className="input" inputMode="decimal" value={g.metric.target} onChange={(e) => set({ metric: { ...g.metric!, target: Number(e.target.value) || 0 } })} /></Field>
                <Field label="Unit"><input id={`g-mu-${g.id}`} className="input" value={g.metric.unit ?? ''} onChange={(e) => set({ metric: { ...g.metric!, unit: e.target.value || undefined } })} /></Field>
              </>}
            </div>
            <div className="row">
              <label className="check small"><input type="checkbox" checked={!!g.sustaining} onChange={(e) => set({ sustaining: e.target.checked })} />Sustaining (protect, don’t maximise)</label>
              <span className="row small">Colour:
                {GOAL_COLORS.map((c) => <button key={c} type="button" aria-label={c} aria-pressed={g.color === c} onClick={() => set({ color: c })} style={{ width: 18, height: 18, borderRadius: 4, border: g.color === c ? '2px solid var(--fg)' : '1px solid var(--line)', background: `var(--g-${c})`, cursor: 'pointer' }} />)}
              </span>
            </div>

            <div className="stack tight">
              <h3>Milestones</h3>
              {g.milestones.map((m) => (
                <div key={m.id} className="row nowrap small">
                  <input type="checkbox" checked={m.done} onChange={(e) => updateMilestone(g.id, m.id, { done: e.target.checked })} aria-label={`Done: ${m.title}`} style={{ accentColor: 'var(--accent)' }} />
                  <span className="grow" style={m.done ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{m.title}</span>
                  <span className="xs muted">{HORIZON_LABEL[m.horizon]}</span>
                  {m.dueDate && <span className="mono xs muted">{m.dueDate}</span>}
                  <button className="iconbtn" onClick={() => deleteMilestone(g.id, m.id)} aria-label={`Delete ${m.title}`}><Icon.trash /></button>
                </div>
              ))}
              <form className="row" onSubmit={(e) => { e.preventDefault(); if (!ms.title.trim()) return; addMilestone(g.id, { title: ms.title.trim(), horizon: ms.horizon, dueDate: ms.dueDate || undefined }); setMs({ ...ms, title: '' }); }}>
                <input id={`ms-t-${g.id}`} className="input grow" placeholder="New milestone" value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} aria-label="Milestone title" />
                <select id={`ms-h-${g.id}`} className="input" style={{ width: 'auto' }} value={ms.horizon} onChange={(e) => setMs({ ...ms, horizon: e.target.value as GoalHorizon })} aria-label="Milestone horizon">
                  {(Object.keys(HORIZON_LABEL) as GoalHorizon[]).map((h) => <option key={h} value={h}>{HORIZON_LABEL[h]}</option>)}
                </select>
                <input id={`ms-d-${g.id}`} type="date" className="input" style={{ width: 'auto' }} value={ms.dueDate} onChange={(e) => setMs({ ...ms, dueDate: e.target.value })} aria-label="Milestone due date" />
                <button className="btn sm">Add</button>
              </form>
            </div>

            <div className="stack tight">
              <h3>Next actions</h3>
              {tasks.length === 0 && <p className="small muted">No next actions — this goal can’t be scheduled until it has one.</p>}
              {tasks.slice(0, 6).map((t) => <button key={t.id} className="btn ghost sm" style={{ justifyContent: 'flex-start' }} onClick={() => openTask(t.id)}>{t.title}</button>)}
              <form className="row" onSubmit={(e) => { e.preventDefault(); if (!next.trim()) return; addTask({ title: next, goalIds: [g.id] }); setNext(''); toast('Next action added'); }}>
                <input id={`na-${g.id}`} className="input grow" placeholder="Add a concrete next action" value={next} onChange={(e) => setNext(e.target.value)} aria-label="Next action" />
                <button className="btn sm">Add</button>
              </form>
            </div>
            <div><ConfirmButton label="Delete goal" confirm="Delete goal (tasks are kept)" onConfirm={() => deleteGoal(g.id)} /></div>
          </div>
        )}
      </div>
      <div className="stack tight" style={{ alignItems: 'flex-end' }}>
        <span className="xs muted">Importance</span>
        <RatingInput label={`${g.name} importance`} value={g.importance} onChange={(v) => v && set({ importance: v })} />
      </div>
    </div>
  );
}
