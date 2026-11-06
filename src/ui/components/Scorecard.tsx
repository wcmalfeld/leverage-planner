import { useState } from 'react';
import type { Scorecard as Card, Stall } from '../../engine/alignment';
import { STALL_LABEL } from '../../engine/alignment';
import { ruleSuggestions } from '../../engine/advisor';
import { fmtDuration, todayISO } from '../../domain/time';
import { useApp } from '../../store/store';
import { addTask, commitTo, updateGoal } from '../../store/actions';
import { GoalTag, goalColor, toast } from './common';
import { useUI } from '../App';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Target vs planned vs actual per goal, and how much logged time served no goal at all. */
export function ScorecardPanel({ card, title = 'Goal time scorecard' }: { card: Card; title?: string }) {
  const { go } = useUI();
  const unaligned = card.unlinkedMin + card.distractionMin;
  return (
    <section className="panel stack">
      <div className="panel-head"><h2>{title}</h2><button className="btn sm ghost" onClick={() => go('goals')}>Set targets</button></div>
      <div className="row nowrap" style={{ alignItems: 'flex-end', gap: '1rem' }}>
        <div>
          <div className="aligned-big">{card.alignedPct === null ? '—' : pct(card.alignedPct)}</div>
          <div className="xs muted">of logged time went to your goals</div>
        </div>
        <div className="small muted grow" style={{ textAlign: 'right' }}>
          {fmtDuration(card.goalMin)} on goals<br />
          <span style={unaligned ? { color: 'var(--crit)' } : undefined}>{fmtDuration(unaligned)} unaligned</span>
        </div>
      </div>
      <div className="scorecard">
        {card.rows.map((r) => {
          const under = card.goalMin >= 60 && r.actualShare < r.target.share * 0.6;
          return [
            <span key={r.goal.id + 'n'} className="name"><GoalTag goal={r.goal} /></span>,
            <div key={r.goal.id + 'b'} className="bars" title={`Target ${pct(r.target.share)}${r.target.explicit ? '' : ' (implied)'} · planned ${fmtDuration(r.plannedMin)} · actual ${fmtDuration(r.actualMin)}`}>
              <div className="bar" style={{ width: pct(r.actualShare), background: goalColor(r.goal) }} />
              <div className="bar plan" style={{ width: pct(r.plannedShare), background: goalColor(r.goal) }} />
              <i className="target" style={{ left: pct(r.target.share) }} />
            </div>,
            <span key={r.goal.id + 'v'} className={`num${under ? ' under' : ''}`}>{pct(r.actualShare)} / {pct(r.target.share)}</span>,
          ];
        })}
        {unaligned > 0 && [
          <span key="u-n" className="name small muted">No goal</span>,
          <span key="u-b" className="xs muted">{card.unlinkedMin ? `${fmtDuration(card.unlinkedMin)} unlinked` : ''}{card.unlinkedMin && card.distractionMin ? ' · ' : ''}{card.distractionMin ? `${fmtDuration(card.distractionMin)} distraction` : ''}</span>,
          <span key="u-v" className="num under">{fmtDuration(unaligned)}</span>,
        ]}
      </div>
      <p className="xs faint">Solid bar: share of your goal time actually logged. Faded bar: share planned. Line: your target. Numbers are actual / target.</p>
    </section>
  );
}

/** Goals that are quietly fading, each with a one-click way to get it moving. */
export function StalledGoals({ stalls }: { stalls: Stall[] }) {
  const data = useApp();
  const { openTask } = useUI();
  const today = todayISO();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  if (!stalls.length) return null;
  const suggestion = (goalId: string) => ruleSuggestions(data, today).find((s) => s.goalId === goalId && s.draft)?.draft;

  return (
    <section className="panel">
      <div className="panel-head"><h2>Goals losing momentum</h2><span className="xs muted">{stalls.length}</span></div>
      <div className="list">
        {stalls.map((s) => {
          const top = s.topTaskId ? data.tasks.find((t) => t.id === s.topTaskId) : undefined;
          const draft = drafts[s.goal.id] ?? '';
          return (
            <div key={s.goal.id} className="stack tight" style={{ padding: '.6rem 0' }}>
              <div className="row between">
                <GoalTag goal={s.goal} />
                <span className={`chip ${s.reason === 'not-scheduled' ? '' : 'warn'}`}>{STALL_LABEL[s.reason]}</span>
              </div>
              <p className="small muted">{s.detail}</p>
              {s.reason === 'no-next-action' ? (
                <form className="row nowrap" onSubmit={(e) => {
                  e.preventDefault();
                  if (!draft.trim()) return;
                  const sug = suggestion(s.goal.id);
                  addTask({ ...(sug?.title === draft.trim() ? sug : {}), title: draft, goalIds: [s.goal.id] });
                  setDrafts({ ...drafts, [s.goal.id]: '' });
                  toast('Next action added');
                }}>
                  <input id={`stall-na-${s.goal.id}`} className="input grow" value={draft} onChange={(e) => setDrafts({ ...drafts, [s.goal.id]: e.target.value })} placeholder="One concrete next action" aria-label={`Next action for ${s.goal.name}`} />
                  {!draft && suggestion(s.goal.id) && <button type="button" className="btn sm ghost" onClick={() => setDrafts({ ...drafts, [s.goal.id]: suggestion(s.goal.id)!.title! })}>Suggest</button>}
                  <button className="btn sm" disabled={!draft.trim()}>Add</button>
                </form>
              ) : top && (
                <div className="row">
                  <button className="btn sm primary" onClick={() => { commitTo(top.id, today); toast(`“${top.title}” is on today’s plan`); }}>Do “{top.title}” today</button>
                  <button className="btn sm ghost" onClick={() => openTask(top.id)}>Details</button>
                  {s.reason === 'no-progress' && <button className="btn sm ghost" title="Paused goals stop counting toward targets and alerts" onClick={() => { updateGoal(s.goal.id, { status: 'paused' }); toast(`${s.goal.name} paused`); }}>Pause goal</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
