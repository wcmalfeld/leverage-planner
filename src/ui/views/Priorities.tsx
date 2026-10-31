import { useState } from 'react';
import type { Tier, Weights } from '../../domain/types';
import { useApp, update } from '../../store/store';
import { useRanking } from '../../store/derived';
import { todayISO } from '../../domain/time';
import { DEFAULT_WEIGHTS, FACTOR_LABELS, WEIGHT_RATIONALE, topReasons, whyAbove, type FactorKey } from '../../engine/scoring';
import { TIER_INFO } from '../../engine/classify';
import { Empty, GoalTag, TierChip } from '../components/common';
import { ScoreBar, ScoreExplain } from '../components/ScoreExplain';
import { useUI } from '../App';

export function PrioritiesView() {
  const data = useApp();
  const today = todayISO();
  const { ranked, classes } = useRanking(today);
  const { openTask } = useUI();
  const [open, setOpen] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<Tier | ''>('');
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));
  const shown = ranked.filter((r) => !tierFilter || classes.get(r.task.id)?.tier === tierFilter);
  const busywork = ranked.filter((r) => classes.get(r.task.id)?.busywork);
  const tierCounts = (Object.keys(TIER_INFO) as Tier[]).map((t) => [t, ranked.filter((r) => classes.get(r.task.id)?.tier === t).length] as const);

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Prioritisation engine</div>
          <h1>Ranked by leverage</h1>
          <p>Each score is a weighted blend of eight factors computed from what you entered. Open any task to see exactly where its points come from and why it beats the next one.</p>
        </div>
      </header>

      <div className="row">
        <button className={`chip`} aria-pressed={!tierFilter} style={!tierFilter ? { background: 'var(--accent-soft)', color: 'var(--fg)' } : undefined} onClick={() => setTierFilter('')}>All {ranked.length}</button>
        {tierCounts.map(([t, n]) => (
          <button key={t} className={`chip tier-${t}`} aria-pressed={tierFilter === t} style={tierFilter === t ? { outline: '2px solid currentColor' } : undefined} onClick={() => setTierFilter(tierFilter === t ? '' : t)} title={TIER_INFO[t].advice}>
            {TIER_INFO[t].label} · {n}
          </button>
        ))}
      </div>

      <div className="plan-layout">
        <section className="panel">
          {shown.length === 0 ? <Empty title="No open tasks">Add tasks in the inbox to see them ranked.</Empty> : (
            <div className="list">
              {shown.map((r, i) => {
                const c = classes.get(r.task.id)!;
                const next = shown[i + 1];
                const isOpen = open === r.task.id;
                return (
                  <div key={r.task.id} className="stack tight" style={{ padding: '.7rem 0' }}>
                    <button className="row nowrap" style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setOpen(isOpen ? null : r.task.id)} aria-expanded={isOpen}>
                      <span className="mono faint xs" style={{ width: '1.8em' }}>{r.rank}</span>
                      <span className="score-num">{Math.round(r.result.score)}</span>
                      <div className="grow stack" style={{ gap: 4 }}>
                        <div className="row nowrap between">
                          <span className="item-title">{r.task.title}</span>
                          <TierChip tier={c.tier} />
                        </div>
                        <ScoreBar result={r.result} />
                        <div className="row xs muted">
                          <GoalTag goal={goalsById.get(r.result.primaryGoalId ?? '')} />
                          {r.result.blocked && <span className="chip">Blocked</span>}
                          {c.busywork && <span className="chip crit">Busywork?</span>}
                          <span>{topReasons(r.result, 2).map((f) => f.note).join(' · ')}</span>
                        </div>
                      </div>
                    </button>
                    {isOpen && (
                      <div className="panel flat stack tight" style={{ marginLeft: '1.8em' }}>
                        <p className="small"><strong>{c.reason}.</strong> {TIER_INFO[c.tier].advice}</p>
                        {next && whyAbove(r.result, next.result).length > 0 && (
                          <p className="small muted">Ranks above “{next.task.title}” on {whyAbove(r.result, next.result).join(' and ')}.</p>
                        )}
                        {c.busywork && <p className="small" style={{ color: 'var(--crit)' }}>{c.busyworkReason}. It may feel productive without moving a goal.</p>}
                        <ScoreExplain result={r.result} />
                        <div><button className="btn sm" onClick={() => openTask(r.task.id)}>Edit task inputs</button></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="side-sticky">
          {busywork.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Productive-looking, weakly connected</h3></div>
              <div className="list">
                {busywork.map((r) => (
                  <div key={r.task.id} className="item clickable" onClick={() => openTask(r.task.id)}>
                    <div className="grow"><div className="item-title small">{r.task.title}</div><div className="xs muted">{classes.get(r.task.id)?.busyworkReason}</div></div>
                  </div>
                ))}
              </div>
            </section>
          )}
          <WeightsPanel weights={data.settings.weights} />
        </aside>
      </div>
    </>
  );
}

function WeightsPanel({ weights }: { weights: Weights }) {
  const [info, setInfo] = useState<FactorKey | null>(null);
  const total = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const set = (k: FactorKey, v: number) => update((d) => { d.settings.weights[k] = v; });
  const isDefault = (Object.keys(DEFAULT_WEIGHTS) as FactorKey[]).every((k) => DEFAULT_WEIGHTS[k] === weights[k]);
  return (
    <section className="panel stack tight">
      <div className="panel-head" style={{ marginBottom: 0 }}>
        <h3>Weights</h3>
        {!isDefault && <button className="btn sm ghost" onClick={() => update((d) => { d.settings.weights = { ...DEFAULT_WEIGHTS }; })}>Reset to defaults</button>}
      </div>
      <p className="xs muted">How much each factor counts. Changes re-rank instantly.</p>
      {(Object.keys(FACTOR_LABELS) as FactorKey[]).map((k) => (
        <div key={k} className="stack" style={{ gap: 2 }}>
          <div className="row between nowrap">
            <label htmlFor={`w-${k}`} className="small row nowrap"><i className={`f-${k}`} style={{ width: 8, height: 8, borderRadius: 2, display: 'inline-block' }} />{FACTOR_LABELS[k]}</label>
            <span className="row nowrap">
              <span className="mono xs muted">{weights[k].toFixed(1)} · {Math.round((weights[k] / total) * 100)}%</span>
              <button className="iconbtn" aria-label={`Why this default for ${FACTOR_LABELS[k]}`} onClick={() => setInfo(info === k ? null : k)} style={{ fontSize: '.75rem' }}>?</button>
            </span>
          </div>
          <input id={`w-${k}`} className="slider" type="range" min={0} max={3} step={0.1} value={weights[k]} onChange={(e) => set(k, Number(e.target.value))} />
          {info === k && <p className="xs muted">{WEIGHT_RATIONALE[k]} Default {DEFAULT_WEIGHTS[k]}.</p>}
        </div>
      ))}
    </section>
  );
}
