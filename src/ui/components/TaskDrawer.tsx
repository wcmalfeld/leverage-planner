import { useState } from 'react';
import type { Energy, Recurrence, Task, TaskStatus, Tier } from '../../domain/types';
import { DAY_NAMES, fmtDuration, todayISO } from '../../domain/time';
import { useApp } from '../../store/store';
import { useRanking } from '../../store/derived';
import { clarifyTask, completeTask, deleteTask, reopenTask, updateTask } from '../../store/actions';
import { TIER_INFO } from '../../engine/classify';
import { ConfirmButton, Drawer, Field, GoalTag, RatingInput, Seg, TierChip, toast } from './common';
import { ScoreExplain } from './ScoreExplain';

const STATUSES: TaskStatus[] = ['inbox', 'ready', 'scheduled', 'in_progress', 'completed', 'deferred'];
const STATUS_LABEL: Record<TaskStatus, string> = { inbox: 'Inbox', ready: 'Ready', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed', deferred: 'Deferred' };

export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const data = useApp();
  const today = todayISO();
  const { rankedById, classes } = useRanking(today);
  const task = data.tasks.find((t) => t.id === taskId);
  const [clarify, setClarify] = useState({ title: '', expectedResult: '', durationMin: '' });
  const [done, setDone] = useState({ minutes: '', outcome: '' });
  if (!task) return null;
  const set = (patch: Partial<Task>) => updateTask(task.id, patch);
  const ranked = rankedById.get(task.id);
  const cls = classes.get(task.id);
  const goals = [...data.goals].sort((a, b) => a.order - b.order);
  const others = data.tasks.filter((t) => t.id !== task.id && t.status !== 'completed');
  const vague = !task.expectedResult || task.durationMin === undefined;

  return (
    <Drawer title="Task" onClose={onClose}>
      <Field label="Title">
        <input id="td-title" className="input" value={task.title} onChange={(e) => set({ title: e.target.value })} />
      </Field>

      {ranked && cls && (
        <div className="panel stack tight">
          <div className="row between">
            <div className="row">
              <TierChip tier={cls.tier} />
              <span className="small muted">{cls.reason}</span>
            </div>
            <span className="mono">#{ranked.rank} · {Math.round(ranked.result.score)}</span>
          </div>
          {cls.busywork && <p className="small" style={{ color: 'var(--crit)' }}>Looks productive, weak goal link: {cls.busyworkReason}.</p>}
          <ScoreExplain result={ranked.result} />
        </div>
      )}

      {vague && task.status !== 'completed' && (
        <section className="panel stack tight">
          <h3>Clarify into a next action</h3>
          <p className="small muted">Turn “{task.title}” into something you could start in the next five minutes. The original idea is parked, not lost.</p>
          <Field label="Concrete next action" hint="e.g. “Message two engineers at Acme and ask for 20-minute calls”">
            <input id="cl-title" className="input" value={clarify.title} onChange={(e) => setClarify({ ...clarify, title: e.target.value })} />
          </Field>
          <div className="fields">
            <Field label="Done looks like"><input id="cl-done" className="input" value={clarify.expectedResult} onChange={(e) => setClarify({ ...clarify, expectedResult: e.target.value })} /></Field>
            <Field label="Minutes"><input id="cl-min" className="input" inputMode="numeric" value={clarify.durationMin} onChange={(e) => setClarify({ ...clarify, durationMin: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
          <div><button className="btn primary sm" disabled={!clarify.title.trim()} onClick={() => {
            clarifyTask(task.id, { title: clarify.title, expectedResult: clarify.expectedResult || undefined, durationMin: clarify.durationMin ? Number(clarify.durationMin) : undefined, impact: task.impact, compounding: task.compounding });
            toast('Next action created');
            onClose();
          }}>Create next action</button></div>
        </section>
      )}

      <section className="stack">
        <Field label="Goals it advances">
          <div className="row">
            {goals.map((g) => {
              const on = task.goalIds.includes(g.id);
              return (
                <button key={g.id} type="button" className="chip" aria-pressed={on} style={on ? { background: 'var(--accent-soft)', color: 'var(--fg)' } : undefined}
                  onClick={() => set({ goalIds: on ? task.goalIds.filter((x) => x !== g.id) : [...task.goalIds, g.id] })}>
                  <GoalTag goal={g} />
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Expected result — what does done look like?">
          <input id="td-result" className="input" value={task.expectedResult ?? ''} onChange={(e) => set({ expectedResult: e.target.value || undefined })} />
        </Field>
        <div className="fields">
          <Field label="Duration (min)">
            <input id="td-dur" className="input" inputMode="numeric" value={task.durationMin ?? ''} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); set({ durationMin: v ? Math.min(600, Number(v)) : undefined }); }} />
          </Field>
          <Field label="Deadline">
            <input id="td-deadline" className="input" type="date" value={task.deadline ?? ''} onChange={(e) => set({ deadline: e.target.value || undefined })} />
          </Field>
          <Field label="Status">
            <select id="td-status" className="input" value={task.status} onChange={(e) => set({ status: e.target.value as TaskStatus })}>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Location" hint="Blank = anywhere">
            <input id="td-loc" className="input" value={task.location ?? ''} placeholder="home, town…" onChange={(e) => set({ location: e.target.value.trim() || undefined })} />
          </Field>
        </div>
        <div className="fields">
          <Field label="Impact if it works"><RatingInput label="Impact" value={task.impact} onChange={(v) => set({ impact: v })} /></Field>
          <Field label="Confidence it pays off"><RatingInput label="Confidence" value={task.confidence} onChange={(v) => set({ confidence: v })} /></Field>
          <Field label="Compounding value"><RatingInput label="Compounding" value={task.compounding} onChange={(v) => set({ compounding: v })} /></Field>
        </div>
        <div className="fields">
          <Field label="Energy needed">
            <Seg<Energy> label="Energy" value={task.energy} onChange={(v) => set({ energy: v })} options={[{ v: 'low', l: 'Low' }, { v: 'medium', l: 'Med' }, { v: 'high', l: 'High' }]} />
          </Field>
          <Field label="Repeats">
            <select id="td-rec" className="input" value={task.recurrence} onChange={(e) => set({ recurrence: e.target.value as Recurrence })}>
              <option value="none">No</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option>
            </select>
          </Field>
          {task.recurrence === 'weekly' && (
            <Field label="On">
              <select id="td-recday" className="input" value={task.recurrenceDay ?? 1} onChange={(e) => set({ recurrenceDay: Number(e.target.value) })}>
                {DAY_NAMES.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select>
            </Field>
          )}
        </div>
        <div className="row">
          <label className="check"><input type="checkbox" checked={!!task.removesBottleneck} onChange={(e) => set({ removesBottleneck: e.target.checked })} />Attacks my current bottleneck</label>
          <label className="check"><input type="checkbox" checked={!!task.splittable} onChange={(e) => set({ splittable: e.target.checked })} />Can be split into sessions</label>
        </div>
        <Field label="Depends on" hint="It won't be scheduled before these are done (or placed earlier the same day).">
          <select id="td-deps" className="input" value="" onChange={(e) => e.target.value && set({ dependsOn: [...task.dependsOn, e.target.value] })}>
            <option value="">Add a prerequisite…</option>
            {others.filter((o) => !task.dependsOn.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
          </select>
        </Field>
        {task.dependsOn.length > 0 && (
          <div className="row">
            {task.dependsOn.map((id) => {
              const d = data.tasks.find((t) => t.id === id);
              return (
                <span key={id} className={`chip ${d?.status === 'completed' ? 'ok' : 'warn'}`}>
                  {d?.title ?? 'Deleted task'}
                  <button className="iconbtn" style={{ padding: 0 }} aria-label="Remove prerequisite" onClick={() => set({ dependsOn: task.dependsOn.filter((x) => x !== id) })}>×</button>
                </span>
              );
            })}
          </div>
        )}
        <Field label="Classification">
          <select id="td-tier" className="input" value={task.tierOverride ?? ''} onChange={(e) => set({ tierOverride: (e.target.value || undefined) as Tier | undefined })}>
            <option value="">Automatic{cls && !cls.overridden ? ` (${TIER_INFO[cls.tier].short})` : ''}</option>
            {(Object.keys(TIER_INFO) as Tier[]).map((t) => <option key={t} value={t}>{TIER_INFO[t].label}</option>)}
          </select>
        </Field>
        <Field label="Notes">
          <textarea id="td-notes" className="input" value={task.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} />
        </Field>
      </section>

      <section className="panel stack tight">
        {task.status === 'completed' ? (
          <>
            <h3>Completed {task.completedAt}</h3>
            <p className="small muted">{task.actualMin ? `Took ${fmtDuration(task.actualMin)}` : 'No time recorded'}{task.durationMin ? ` (estimated ${fmtDuration(task.durationMin)})` : ''}.</p>
            <Field label="Outcome"><input id="td-outcome" className="input" value={task.outcome ?? ''} onChange={(e) => set({ outcome: e.target.value || undefined })} /></Field>
            <div><button className="btn sm" onClick={() => reopenTask(task.id)}>Reopen</button></div>
          </>
        ) : (
          <>
            <h3>Mark done</h3>
            <div className="fields">
              <Field label="Actual minutes"><input id="td-actual" className="input" inputMode="numeric" placeholder={String(task.durationMin ?? '')} value={done.minutes} onChange={(e) => setDone({ ...done, minutes: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Outcome"><input id="td-out" className="input" value={done.outcome} onChange={(e) => setDone({ ...done, outcome: e.target.value })} placeholder="What did it produce?" /></Field>
            </div>
            <div><button className="btn primary sm" onClick={() => { completeTask(task.id, today, Number(done.minutes) || task.durationMin, done.outcome || undefined); toast('Logged as done'); onClose(); }}>Mark done today</button></div>
          </>
        )}
      </section>

      <div className="row between">
        <span className="xs faint">Created {task.createdAt}{task.postponeCount ? ` · postponed ${task.postponeCount}×` : ''}</span>
        <ConfirmButton label="Delete task" confirm="Delete permanently" onConfirm={() => { deleteTask(task.id); onClose(); toast('Task deleted'); }} />
      </div>
    </Drawer>
  );
}
