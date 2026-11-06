import { useMemo, useState } from 'react';
import { useApp } from '../../store/store';
import { useRanking } from '../../store/derived';
import { generateFor, setLeverageBar, triageTask, undoTriage, type TriageDecision } from '../../store/actions';
import { fmtDateShort, fmtDuration, todayISO } from '../../domain/time';
import { topReasons } from '../../engine/scoring';
import { triage, type TriageItem } from '../../engine/triage';
import { Empty, GoalTag, TierChip, toast } from '../components/common';
import { Icon } from '../components/icons';
import { useUI } from '../App';

const DECISIONS: { d: TriageDecision; label: string; hint: string; done: string }[] = [
  { d: 'drop', label: 'Drop', hint: 'Delete it. If it mattered, it will come back.', done: 'Dropped' },
  { d: 'someday', label: 'Someday', hint: 'Park it in Deferred, out of every plan.', done: 'Moved to Someday' },
  { d: 'snooze', label: 'Snooze a week', hint: 'Hide it for 7 days, then ask again.', done: 'Snoozed for a week' },
  { d: 'keep', label: 'Keep', hint: 'Schedule it anyway, despite the score.', done: 'Kept — it can be scheduled again' },
];

/** Hook for the nav badge: how many tasks are waiting for a triage decision. */
export function useTriageCount() {
  const data = useApp();
  const today = todayISO();
  const { ranked, classes } = useRanking(today);
  return useMemo(() => triage(ranked, classes, data.settings, today).queue.length, [ranked, classes, data.settings, today]);
}

export function TriageView() {
  const data = useApp();
  const today = todayISO();
  const { ranked, classes } = useRanking(today);
  const { openTask } = useUI();
  const bar = data.settings.leverageBar;
  const t = useMemo(() => triage(ranked, classes, data.settings, today), [ranked, classes, data.settings, today]);
  const kept = ranked.filter((r) => r.task.keepBelowBar && r.result.score < bar);
  const someday = data.tasks.filter((x) => x.status === 'deferred');
  const [showParked, setShowParked] = useState(false);

  const decide = (item: TriageItem, d: (typeof DECISIONS)[number]) => {
    if (d.d === 'drop' && !confirm(`Delete “${item.ranked.task.title}”? This can't be undone.`)) return;
    triageTask(item.ranked.task.id, d.d, today);
    if (data.plans[today]) generateFor(today);
    toast(d.done);
  };

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Triage</div>
          <h1>Below the bar</h1>
          <p>
            Tasks scoring under your leverage bar are left out of your plans. Decide about each one here, with its payoff in front of you:
            research on the “mere urgency effect” shows people pick urgent-looking, low-payoff work over important work unless the payoff is visible when they choose.
          </p>
        </div>
      </header>

      <section className="panel stack tight">
        <div className="row between">
          <h3>Leverage bar</h3>
          <span className="small muted">{bar === 0 ? 'Off: every task can be scheduled' : `${t.clearing} of ${t.open} open tasks clear it`}</span>
        </div>
        <div className="row nowrap">
          <input id="lev-bar" className="slider grow" type="range" min={0} max={80} step={1} value={bar}
            onChange={(e) => setLeverageBar(Number(e.target.value))}
            onPointerUp={() => data.plans[today] && generateFor(today)} onKeyUp={() => data.plans[today] && generateFor(today)}
            aria-label="Leverage bar" />
          <span className="score-num" style={{ minWidth: '2.2em', textAlign: 'right' }}>{bar}</span>
        </div>
        <p className="xs muted">Scores run 0–100 (see Priorities). Exempt even when below the bar: tasks due within a day, ones you’ve committed to a date, prerequisites, upkeep and bottleneck work, and anything you choose to keep.</p>
      </section>

      <div className="plan-layout">
        <section className="panel">
          <div className="panel-head"><h3>Needs a decision</h3><span className="xs muted">{t.queue.length}</span></div>
          {t.queue.length === 0 ? (
            <Empty title={bar === 0 ? 'The bar is off' : 'Nothing below the bar'}>{bar === 0 ? 'Raise the bar above to start filtering out low-leverage tasks.' : 'Every open task clears your bar or has a reason to stay.'}</Empty>
          ) : (
            <div className="list">
              {t.queue.map((item) => {
                const r = item.ranked;
                const reasons = topReasons(r.result, 2).map((f) => f.note);
                return (
                  <div key={r.task.id} className="stack tight" style={{ padding: '.75rem 0' }}>
                    <div className="row nowrap">
                      <span className="score-num" title="Leverage score">{Math.round(r.result.score)}</span>
                      <div className="grow stack" style={{ gap: 3 }}>
                        <div className="row nowrap between">
                          <button className="item-title" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }} onClick={() => openTask(r.task.id)}>{r.task.title}</button>
                          <TierChip tier={item.tier} />
                        </div>
                        <div className="row xs muted">
                          <GoalTag goal={data.goals.find((g) => g.id === r.result.primaryGoalId)} />
                          <span>{fmtDuration(r.task.durationMin ?? data.settings.defaultDurationMin)}</span>
                          <span>{Math.round(bar - r.result.score)} below the bar</span>
                          {r.task.postponeCount > 1 && <span className="chip warn">Postponed {r.task.postponeCount}×</span>}
                        </div>
                        <p className="small">{reasons.length ? `Payoff: ${reasons.join('; ')}.` : 'No factor stands out: modest payoff on every count.'}</p>
                        {item.urgencyLed && <p className="small" style={{ color: 'var(--warn)' }}>Most of its score is urgency. It feels pressing, but the payoff is small.</p>}
                      </div>
                    </div>
                    <div className="row" style={{ marginLeft: '2.6em' }}>
                      {DECISIONS.map((d) => (
                        <button key={d.d} className={`btn sm${d.d === 'drop' ? ' ghost' : ''}`} title={d.hint} onClick={() => decide(item, d)}>{d.label}</button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="side-sticky">
          {t.exempt.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Below the bar, still scheduled</h3></div>
              <div className="list">
                {t.exempt.map((i) => (
                  <div key={i.ranked.task.id} className="item clickable" onClick={() => openTask(i.ranked.task.id)}>
                    <span className="mono small">{Math.round(i.ranked.result.score)}</span>
                    <div className="grow"><div className="item-title small">{i.ranked.task.title}</div><div className="xs muted">{i.exempt}</div></div>
                    {i.ranked.task.keepBelowBar && <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); undoTriage(i.ranked.task.id); toast('Back in the triage queue'); }}>Undo keep</button>}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="panel">
            <button className="panel-head row between" style={{ border: 0, background: 'none', width: '100%', padding: 0, cursor: 'pointer' }} onClick={() => setShowParked(!showParked)} aria-expanded={showParked}>
              <h3>Snoozed and someday</h3><span className="xs muted">{t.snoozed.length + someday.length} {showParked ? <Icon.up /> : <Icon.down />}</span>
            </button>
            {showParked && (t.snoozed.length + someday.length === 0 ? <p className="small muted">Nothing parked.</p> : (
              <div className="list">
                {[...t.snoozed, ...someday].map((x) => (
                  <div key={x.id} className="item">
                    <div className="grow"><div className="small item-title">{x.title}</div><div className="xs muted">{x.status === 'deferred' ? 'Someday' : `Snoozed until ${fmtDateShort(x.snoozedUntil!)}`}</div></div>
                    <button className="btn sm ghost" onClick={() => { undoTriage(x.id); toast('Back on your list'); }}>Bring back</button>
                  </div>
                ))}
              </div>
            ))}
            {kept.length > 0 && <p className="xs faint">{kept.length} kept below the bar.</p>}
          </section>
        </aside>
      </div>
    </>
  );
}
