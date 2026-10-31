import { useState } from 'react';
import { store, useApp, update } from '../../store/store';
import { addGoal, addTask, deleteGoal, finishOnboarding, moveGoal, setBottleneck, updateGoal } from '../../store/actions';
import { fromHHMM, toHHMM } from '../../domain/time';
import { Field, RatingInput } from '../components/common';
import { BrandMark, Icon } from '../components/icons';

export function Onboarding({ onDone }: { onDone: () => void }) {
  const data = useApp();
  const [step, setStep] = useState(0);
  const goals = [...data.goals].sort((a, b) => a.order - b.order);
  const [newGoal, setNewGoal] = useState('');
  const [bn, setBn] = useState({ statement: data.bottleneck.statement, goalIds: data.bottleneck.goalIds });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskGoal, setTaskGoal] = useState(goals[0]?.id ?? '');
  const [added, setAdded] = useState<string[]>([]);
  const s = data.settings;

  const finish = () => {
    if (bn.statement.trim()) setBottleneck(bn.statement, bn.goalIds);
    finishOnboarding();
    onDone();
  };

  return (
    <div className="modal">
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Set up">
        <div className="stack" style={{ padding: '1.5rem' }}>
          {step > 0 && <div className="onboard-steps" aria-hidden="true">{[1, 2, 3].map((i) => <i key={i} className={i <= step ? 'on' : ''} />)}</div>}

          {step === 0 && (
            <div className="stack">
              <div className="row nowrap"><BrandMark /><span className="eyebrow">Personal strategy engine</span></div>
              <h1>Spend today on what actually moves your life forward.</h1>
              <p className="muted">You set the goals and the constraints. The planner ranks what you could do by leverage, explains every ranking, fits the best of it around your real day — sleep, meals, riding and people included — and shows how that compares with what you’d otherwise do.</p>
              <div className="grid2">
                <button className="panel stack tight" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setStep(1)}>
                  <h3>Set up my own plan</h3>
                  <p className="small muted">About three minutes: goals, your bottleneck, day shape, a few tasks.</p>
                  <span className="row small" style={{ color: 'var(--accent)', fontWeight: 700 }}>Start <Icon.arrow /></span>
                </button>
                <button className="panel stack tight" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { store.loadDemo(); onDone(); }}>
                  <h3>Explore with example data</h3>
                  <p className="small muted">A filled-in week for someone job-hunting while growing a tutoring business. Replace it any time from Data.</p>
                  <span className="row small" style={{ color: 'var(--accent)', fontWeight: 700 }}>Load example <Icon.arrow /></span>
                </button>
              </div>
              <p className="xs faint">Everything stays in this browser. No account, no tracking, no AI calls.</p>
            </div>
          )}

          {step === 1 && (
            <div className="stack">
              <h2>What are you building toward?</h2>
              <p className="small muted">These are starting categories, not assumptions — rename, reorder, rate or remove them. Order and importance drive the ranking.</p>
              <div className="list">
                {goals.map((g, i) => (
                  <div key={g.id} className="row nowrap" style={{ padding: '.45rem 0' }}>
                    <div className="stack" style={{ gap: 0 }}>
                      <button className="iconbtn" disabled={i === 0} onClick={() => moveGoal(g.id, -1)} aria-label={`Move ${g.name} up`}><Icon.up /></button>
                      <button className="iconbtn" disabled={i === goals.length - 1} onClick={() => moveGoal(g.id, 1)} aria-label={`Move ${g.name} down`}><Icon.down /></button>
                    </div>
                    <input id={`ob-g-${g.id}`} className="input grow" value={g.name} onChange={(e) => updateGoal(g.id, { name: e.target.value })} aria-label="Goal name" />
                    <RatingInput label={`${g.name} importance`} value={g.importance} onChange={(v) => v && updateGoal(g.id, { importance: v })} />
                    <button className="iconbtn" onClick={() => deleteGoal(g.id)} aria-label={`Remove ${g.name}`}><Icon.trash /></button>
                  </div>
                ))}
              </div>
              <form className="row" onSubmit={(e) => { e.preventDefault(); if (newGoal.trim()) { addGoal(newGoal.trim()); setNewGoal(''); } }}>
                <input id="ob-new-goal" className="input grow" value={newGoal} onChange={(e) => setNewGoal(e.target.value)} placeholder="Add another goal" aria-label="New goal" />
                <button className="btn sm">Add</button>
              </form>
            </div>
          )}

          {step === 2 && (
            <div className="stack">
              <h2>What’s holding everything back?</h2>
              <Field label="Your current bottleneck" hint="The one constraint that, if resolved, would unlock the most progress everywhere.">
                <input id="ob-bn" className="input" value={bn.statement} onChange={(e) => setBn({ ...bn, statement: e.target.value })} placeholder="e.g. No reliable income yet" />
              </Field>
              <div className="row">
                {goals.map((g) => (
                  <label key={g.id} className="check small"><input type="checkbox" checked={bn.goalIds.includes(g.id)} onChange={(e) => setBn({ ...bn, goalIds: e.target.checked ? [...bn.goalIds, g.id] : bn.goalIds.filter((x) => x !== g.id) })} />{g.name}</label>
                ))}
              </div>
              <h3>Your day’s shape</h3>
              <div className="fields">
                <Field label="Day starts"><input id="ob-wake" type="time" className="input" value={toHHMM(s.wake)} onChange={(e) => update((d) => { d.settings.wake = fromHHMM(e.target.value); })} /></Field>
                <Field label="Bedtime"><input id="ob-sleep" type="time" className="input" value={toHHMM(s.sleep)} onChange={(e) => update((d) => { d.settings.sleep = fromHHMM(e.target.value); })} /></Field>
                <Field label="Best focus from"><input id="ob-fs" type="time" className="input" value={toHHMM(s.focusWindows[0]?.start ?? 480)} onChange={(e) => update((d) => { d.settings.focusWindows[0] = { start: fromHHMM(e.target.value), end: d.settings.focusWindows[0]?.end ?? 690 }; })} /></Field>
                <Field label="Best focus until"><input id="ob-fe" type="time" className="input" value={toHHMM(s.focusWindows[0]?.end ?? 690)} onChange={(e) => update((d) => { d.settings.focusWindows[0] = { start: d.settings.focusWindows[0]?.start ?? 480, end: fromHHMM(e.target.value) }; })} /></Field>
              </div>
              <p className="small muted">Meals, a morning routine and a wind-down are already set as protected routines. Add work, training and appointments under Routine.</p>
            </div>
          )}

          {step === 3 && (
            <div className="stack">
              <h2>What could you do this week?</h2>
              <p className="small muted">Capture a few candidate actions. Rough is fine — you can clarify, rate and add durations later.</p>
              <form className="capture" onSubmit={(e) => { e.preventDefault(); if (!taskTitle.trim()) return; addTask({ title: taskTitle, goalIds: taskGoal ? [taskGoal] : [] }); setAdded([...added, taskTitle.trim()]); setTaskTitle(''); }}>
                <input id="ob-task" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="e.g. Follow up with three tutoring leads" aria-label="Task" autoFocus />
                <select id="ob-task-goal" className="input" style={{ width: 'auto', maxWidth: '40%', border: 0 }} value={taskGoal} onChange={(e) => setTaskGoal(e.target.value)} aria-label="Goal">
                  <option value="">No goal</option>
                  {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <button className="btn primary sm"><Icon.plus />Add</button>
              </form>
              {added.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>{added.map((t, i) => <li key={i}>{t}</li>)}</ul>}
            </div>
          )}

          {step > 0 && (
            <div className="row between">
              <button className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>
              {step < 3 ? <button className="btn primary" onClick={() => setStep(step + 1)} disabled={step === 1 && goals.length === 0}>Continue <Icon.arrow /></button>
                : <button className="btn primary" onClick={finish}>Build today’s plan <Icon.arrow /></button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
