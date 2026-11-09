import { useState } from 'react';
import type { Goal, Rating } from '../../domain/types';
import { fmtDuration, todayISO, uid } from '../../domain/time';
import { useApp } from '../../store/store';
import { freshStart, type FreshStartPlan } from '../../store/actions';
import { templateDrafts } from '../../engine/advisor';
import { GOAL_COLORS } from '../../store/seed';
import { aiReady, useAISettings } from '../../ai/settings';
import { Field, GoalTag, RatingInput, Seg, toast } from './common';
import { Icon } from './icons';
import { useUI } from '../App';

export type FreshMode = 'choose' | 'tasks' | 'goals';

interface Draft {
  id: string;
  goalKey: string;
  title: string;
  durationMin: number;
  expectedResult?: string;
  firstStep?: string;
}

const DURATIONS = [15, 30, 45, 60, 90, 120];
const blank = (goalKey: string): Draft => ({ id: uid('d'), goalKey, title: '', durationMin: 45 });

/**
 * Start the day over from your goals: clear the old task list (parked, not lost),
 * optionally replace the goals themselves, then pick today's tasks goal by goal.
 */
export function FreshStart({ initial, onClose }: { initial: FreshMode; onClose: () => void }) {
  const data = useApp();
  const ai = useAISettings();
  const { openPlan } = useUI();
  const today = todayISO();
  const [mode, setMode] = useState<FreshMode>(initial);
  const [step, setStep] = useState<'goals' | 'tasks'>(initial === 'goals' ? 'goals' : 'tasks');

  const current = data.goals.filter((g) => g.status === 'active' || g.status === 'paused').sort((a, b) => a.order - b.order);
  const [keep, setKeep] = useState<string[]>([]);
  const [others, setOthers] = useState<'archive' | 'delete'>('archive');
  const [added, setAdded] = useState<{ key: string; name: string; importance: Rating }[]>([]);
  const [newName, setNewName] = useState('');
  const [bn, setBn] = useState({ statement: '', goalKeys: [] as string[] });
  const [oldTasks, setOldTasks] = useState<FreshStartPlan['oldTasks']>('park');
  const [drafts, setDrafts] = useState<Draft[]>(() => (initial === 'tasks' ? data.goals.filter((g) => g.status === 'active').map((g) => blank(g.id)) : []));
  const [asking, setAsking] = useState(false);

  // The goals today's tasks are chosen for: your active goals, or the new set.
  const goals: { key: string; name: string; outcome?: string; color?: string }[] = mode === 'goals'
    ? [...current.filter((g) => keep.includes(g.id)).map((g) => ({ key: g.id, name: g.name, outcome: g.outcome })), ...added.filter((a) => a.name.trim()).map((a) => ({ key: a.key, name: a.name.trim() }))]
    : data.goals.filter((g) => g.status === 'active').sort((a, b) => a.order - b.order).map((g) => ({ key: g.id, name: g.name, outcome: g.outcome }));
  // New goals don't exist yet; give them the colour they'll get when created.
  const maxOrder = Math.max(-1, ...data.goals.map((g) => g.order));
  const goalTag = (key: string): Pick<Goal, 'name' | 'color'> =>
    data.goals.find((g) => g.id === key) ?? { name: goals.find((g) => g.key === key)?.name ?? '', color: GOAL_COLORS[(maxOrder + 1 + added.findIndex((a) => a.key === key)) % GOAL_COLORS.length] };

  const openOneOff = data.tasks.filter((t) => t.recurrence === 'none' && t.status !== 'completed' && t.status !== 'deferred');
  const routines = data.tasks.filter((t) => t.recurrence !== 'none' && t.status !== 'completed' && t.status !== 'deferred');
  const filled = drafts.filter((d) => d.title.trim() && goals.some((g) => g.key === d.goalKey));
  const totalMin = filled.reduce((s, d) => s + d.durationMin, 0);

  const toTasks = () => {
    setDrafts((ds) => [...ds.filter((d) => goals.some((g) => g.key === d.goalKey)), ...goals.filter((g) => !ds.some((d) => d.goalKey === g.key)).map((g) => blank(g.key))]);
    setStep('tasks');
  };
  const choose = (m: 'tasks' | 'goals') => {
    setMode(m);
    if (m === 'goals') setStep('goals');
    else {
      setDrafts(data.goals.filter((g) => g.status === 'active').map((g) => blank(g.id)));
      setStep('tasks');
    }
  };

  const setDraft = (id: string, p: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...p } : d)));
  const suggest = (goal: (typeof goals)[number]) => {
    const used = new Set([...data.tasks.map((t) => t.title.toLowerCase()), ...drafts.map((d) => d.title.toLowerCase())]);
    const milestone = data.goals.find((g) => g.id === goal.key)?.milestones.find((m) => !m.done);
    const ideas = [
      ...(milestone ? [{ title: `First step toward: ${milestone.title}`, durationMin: 45 }] : []),
      ...templateDrafts(`${goal.name} ${goal.outcome ?? ''}`),
    ].filter((x) => !used.has(x.title!.toLowerCase()));
    if (!ideas.length) return toast(`No built-in idea for ${goal.name}. Write one, or ask Claude.`);
    const idea = ideas[0];
    const into = drafts.find((d) => d.goalKey === goal.key && !d.title.trim());
    const next = { title: idea.title!, durationMin: idea.durationMin ?? 45, expectedResult: idea.expectedResult };
    setDrafts(into ? drafts.map((d) => (d.id === into.id ? { ...d, ...next } : d)) : [...drafts, { ...blank(goal.key), ...next }]);
  };
  const askClaude = async () => {
    setAsking(true);
    try {
      const { suggestDayTasks, describeError } = await import('../../ai/coach');
      try {
        const got = await suggestDayTasks(ai.apiKey, data, today, goals);
        setDrafts((ds) => {
          const kept = ds.filter((d) => d.title.trim());
          const fresh = got.map((t) => ({ ...t, id: uid('d'), durationMin: t.durationMin }));
          return [...kept, ...fresh, ...goals.filter((g) => ![...kept, ...fresh].some((d) => d.goalKey === g.key)).map((g) => blank(g.key))];
        });
        toast(`Claude drafted ${got.length} tasks. Edit or remove any of them.`);
      } catch (e) { toast(describeError(e)); }
    } finally { setAsking(false); }
  };

  const finish = () => {
    freshStart({
      date: today,
      oldTasks,
      goals: mode === 'goals' ? { keep, others, added, bottleneck: bn.statement.trim() ? bn : undefined } : undefined,
      tasks: filled.map(({ goalKey, title, durationMin, expectedResult, firstStep }) => ({ goalKey, title, durationMin, expectedResult, firstStep })),
    });
    toast(filled.length ? `Fresh start: ${filled.length} task${filled.length === 1 ? '' : 's'} planned for today` : 'Fresh start done');
    onClose();
    openPlan(today);
  };

  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Fresh start">
        <div className="stack" style={{ padding: '1.5rem' }}>
          <div className="row between">
            <span className="eyebrow">Fresh start</span>
            <button className="iconbtn" onClick={onClose} aria-label="Close">×</button>
          </div>

          {mode === 'choose' && (
            <div className="stack">
              <h2>Start over from your goals</h2>
              <p className="small muted">Your routine, settings, finished work and logged time stay as they are. Old tasks are parked in Someday unless you choose otherwise, so nothing is lost.</p>
              <div className="grid2">
                <button className="panel stack tight" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => choose('tasks')}>
                  <h3>New tasks for today</h3>
                  <p className="small muted">Keep your goals. Clear the old list and choose today’s tasks goal by goal.</p>
                  <span className="row small" style={{ color: 'var(--accent)', fontWeight: 700 }}>Start <Icon.arrow /></span>
                </button>
                <button className="panel stack tight" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => choose('goals')}>
                  <h3>New goals, clean slate</h3>
                  <p className="small muted">Retire your current goals (or keep a few), set new ones, then choose today’s tasks for them.</p>
                  <span className="row small" style={{ color: 'var(--accent)', fontWeight: 700 }}>Start <Icon.arrow /></span>
                </button>
              </div>
            </div>
          )}

          {mode === 'goals' && step === 'goals' && (
            <div className="stack">
              <h2>New goals</h2>
              {current.length > 0 && (
                <div className="stack tight">
                  <h3>Your current goals</h3>
                  <p className="small muted">Tick any you want to carry over. The rest are {others === 'archive' ? 'archived: out of plans and scores, with their history kept' : 'deleted: their tasks and routines stay, unlinked'}.</p>
                  <div className="row">
                    {current.map((g) => (
                      <label key={g.id} className="check small"><input type="checkbox" checked={keep.includes(g.id)} onChange={(e) => setKeep(e.target.checked ? [...keep, g.id] : keep.filter((x) => x !== g.id))} />Keep {g.name}</label>
                    ))}
                  </div>
                  <Seg<'archive' | 'delete'> label="The others" value={others} onChange={setOthers} options={[{ v: 'archive', l: 'Archive the others' }, { v: 'delete', l: 'Delete the others' }]} />
                </div>
              )}

              <div className="stack tight">
                <h3>What are you building toward now?</h3>
                <p className="small muted">Highest priority first. Importance drives how tasks are ranked.</p>
                {added.map((a, i) => (
                  <div key={a.key} className="row nowrap">
                    <input id={`fs-g-${a.key}`} className="input grow" value={a.name} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Goal name" />
                    <RatingInput label={`${a.name} importance`} value={a.importance} onChange={(v) => v && setAdded(added.map((x, j) => (j === i ? { ...x, importance: v } : x)))} />
                    <button className="iconbtn" onClick={() => setAdded(added.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`}><Icon.trash /></button>
                  </div>
                ))}
                <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (!newName.trim()) return; setAdded([...added, { key: uid('ng'), name: newName.trim(), importance: added.length ? 4 : 5 }]); setNewName(''); }}>
                  <input id="fs-new-goal" className="input grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={added.length ? 'Add another goal' : 'e.g. Land a full-time AI engineering role'} aria-label="New goal" autoFocus />
                  <button className="btn sm"><Icon.plus />Add</button>
                </form>
              </div>

              {goals.length > 0 && (
                <div className="stack tight">
                  <Field label="Your bottleneck (optional)" hint="The one constraint that, if resolved, would unlock the most. Tasks that attack it rank higher.">
                    <input id="fs-bn" className="input" value={bn.statement} onChange={(e) => setBn({ ...bn, statement: e.target.value })} placeholder="e.g. No portfolio that shows I can ship" />
                  </Field>
                  {bn.statement.trim() && (
                    <div className="row">
                      {goals.map((g) => (
                        <label key={g.key} className="check small"><input type="checkbox" checked={bn.goalKeys.includes(g.key)} onChange={(e) => setBn({ ...bn, goalKeys: e.target.checked ? [...bn.goalKeys, g.key] : bn.goalKeys.filter((x) => x !== g.key) })} />{g.name}</label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="row between modal-foot">
                <button className="btn ghost" onClick={() => setMode('choose')}>Back</button>
                <button className="btn primary" disabled={!goals.length} onClick={toTasks}>Choose today’s tasks <Icon.arrow /></button>
              </div>
            </div>
          )}

          {mode !== 'choose' && step === 'tasks' && (
            <div className="stack">
              <h2>Today’s tasks</h2>

              {openOneOff.length > 0 && (
                <div className="stack tight">
                  <span className="small">You have <strong>{openOneOff.length} open task{openOneOff.length === 1 ? '' : 's'}</strong>{routines.length ? ` (plus ${routines.length} recurring, which stay)` : ''}. What should happen to them?</span>
                  <Seg<FreshStartPlan['oldTasks']> label="Old tasks" value={oldTasks} onChange={setOldTasks} options={[{ v: 'park', l: 'Park in Someday' }, { v: 'delete', l: 'Delete' }, { v: 'keep', l: 'Keep them' }]} />
                  <p className="xs muted">{oldTasks === 'park' ? 'Parked tasks leave your plans. Bring any back from Triage → Snoozed and someday.' : oldTasks === 'delete' ? 'Deleted for good. Finished tasks and logged time are kept.' : 'They stay on your list and compete with today’s new tasks.'}</p>
                </div>
              )}

              <div className="row between">
                <span className="small muted">One or two per goal is plenty. These go first in today’s plan.</span>
                {aiReady(ai) && <button className="btn sm" disabled={asking || !goals.length} onClick={askClaude}><Icon.spark />{asking ? 'Thinking…' : 'Draft with Claude'}</button>}
              </div>

              <div className="list">
                {goals.map((g) => (
                  <div key={g.key} className="stack tight" style={{ padding: '.6rem 0' }}>
                    <div className="row between">
                      <GoalTag goal={goalTag(g.key) as Goal} />
                      <button className="btn sm ghost" onClick={() => suggest(g)}>Suggest</button>
                    </div>
                    {drafts.filter((d) => d.goalKey === g.key).map((d) => (
                      <div key={d.id} className="stack" style={{ gap: 2 }}>
                        <div className="row nowrap">
                          <input id={`fs-t-${d.id}`} className="input grow" value={d.title} onChange={(e) => setDraft(d.id, { title: e.target.value })} placeholder={`What will you do today for ${g.name}?`} aria-label={`Task for ${g.name}`} />
                          <select id={`fs-m-${d.id}`} className="input" style={{ width: 'auto' }} value={d.durationMin} onChange={(e) => setDraft(d.id, { durationMin: Number(e.target.value) })} aria-label="Minutes">
                            {[...new Set([...DURATIONS, d.durationMin])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{fmtDuration(m)}</option>)}
                          </select>
                          <button className="iconbtn" onClick={() => setDrafts(drafts.filter((x) => x.id !== d.id))} aria-label="Remove task"><Icon.trash /></button>
                        </div>
                        {(d.expectedResult || d.firstStep) && <span className="xs muted">{[d.expectedResult && `Done: ${d.expectedResult}`, d.firstStep && `First step: ${d.firstStep}`].filter(Boolean).join(' · ')}</span>}
                      </div>
                    ))}
                    <div><button className="btn sm ghost" onClick={() => setDrafts([...drafts, blank(g.key)])}><Icon.plus />Another</button></div>
                  </div>
                ))}
              </div>

              <p className={`small ${totalMin > data.settings.maxWorkMin ? '' : 'muted'}`} style={totalMin > data.settings.maxWorkMin ? { color: 'var(--warn)' } : undefined}>
                {filled.length} task{filled.length === 1 ? '' : 's'} · {fmtDuration(totalMin)}
                {totalMin > data.settings.maxWorkMin ? ` — more than your ${fmtDuration(data.settings.maxWorkMin)} daily cap, so some will roll to tomorrow.` : ''}
              </p>
              <div className="row between modal-foot">
                <button className="btn ghost" onClick={() => (mode === 'goals' ? setStep('goals') : setMode('choose'))}>Back</button>
                <button className="btn primary" disabled={!goals.length} onClick={finish}><Icon.check />Build today’s plan</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
