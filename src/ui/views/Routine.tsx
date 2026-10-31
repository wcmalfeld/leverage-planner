import { useState } from 'react';
import type { Commitment, CommitmentKind, Energy, Settings } from '../../domain/types';
import { useApp, update } from '../../store/store';
import { deleteCommitment, upsertCommitment } from '../../store/actions';
import { DAY_NAMES, addDays, dayOfWeek, fmtDuration, fmtTime, fromHHMM, toHHMM, todayISO, uid } from '../../domain/time';
import { computeAvailability } from '../../engine/availability';
import { ConfirmButton, Field, toast } from '../components/common';
import { Icon } from '../components/icons';

const KINDS: CommitmentKind[] = ['work', 'meal', 'exercise', 'routine', 'appointment', 'travel', 'social', 'rest'];

export function RoutineView() {
  const data = useApp();
  const s = data.settings;
  const set = (p: Partial<Settings>) => update((d) => { Object.assign(d.settings, p); });
  const [editing, setEditing] = useState<Commitment | null>(null);
  const today = todayISO();
  const weekFree = [1, 2, 3, 4, 5, 6, 0].map((i) => {
    const iso = addDays(today, (i - dayOfWeek(today) + 7) % 7);
    return { day: i, free: computeAvailability(iso, s, data.commitments).freeMin };
  });
  const sleepH = (24 * 60 - (s.sleep - s.wake)) / 60;

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Availability</div>
          <h1>Your day’s shape</h1>
          <p>The scheduler only uses time that’s left after sleep, routines, commitments and travel — and still leaves some of it open on purpose.</p>
        </div>
      </header>

      <section className="panel">
        <div className="panel-head"><h2>Flexible time by weekday</h2><span className="xs muted">After commitments and travel</span></div>
        <div className="row" style={{ alignItems: 'flex-end', gap: '.75rem' }}>
          {weekFree.map((w) => (
            <div key={w.day} className="stack tight" style={{ alignItems: 'center', flex: 1, minWidth: 34 }}>
              <span className="mono xs">{fmtDuration(w.free)}</span>
              <div style={{ width: '100%', maxWidth: 46, height: Math.max(4, (w.free / 960) * 90), background: 'var(--accent)', opacity: 0.75, borderRadius: 4 }} />
              <span className="xs muted">{DAY_NAMES[w.day]}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid2">
        <section className="panel stack">
          <h2>Day and sleep</h2>
          <div className="fields">
            <Field label="Day starts"><input id="s-wake" type="time" className="input" value={toHHMM(s.wake)} onChange={(e) => set({ wake: fromHHMM(e.target.value) })} /></Field>
            <Field label="Bedtime"><input id="s-sleep" type="time" className="input" value={toHHMM(s.sleep)} onChange={(e) => set({ sleep: fromHHMM(e.target.value) || 24 * 60 })} /></Field>
          </div>
          <p className={`small ${sleepH < 7 ? '' : 'muted'}`} style={sleepH < 7 ? { color: 'var(--crit)' } : undefined}>{sleepH.toFixed(1)} hours reserved for sleep{sleepH < 7 ? ' — less than 7h. The planner won’t borrow from it, but this setting already does.' : '.'}</p>
          <h3>Pacing</h3>
          <div className="fields">
            <Field label="Open time to keep (min)" hint="Never scheduled"><NumIn id="s-open" v={s.unscheduledMin} on={(v) => set({ unscheduledMin: v })} /></Field>
            <Field label="Buffer after tasks"><NumIn id="s-buf" v={s.bufferMin} on={(v) => set({ bufferMin: v })} /></Field>
            <Field label="Break after (min)"><NumIn id="s-ba" v={s.breakAfterMin} on={(v) => set({ breakAfterMin: Math.max(30, v) })} /></Field>
            <Field label="Break length"><NumIn id="s-bl" v={s.breakMin} on={(v) => set({ breakMin: v })} /></Field>
            <Field label="Longest block" hint="Longer tasks are split"><NumIn id="s-max" v={s.maxBlockMin} on={(v) => set({ maxBlockMin: Math.max(30, v) })} /></Field>
            <Field label="Daily focused-work cap" hint="Beyond this, rest wins"><NumIn id="s-cap" v={s.maxWorkMin} on={(v) => set({ maxWorkMin: Math.max(30, v) })} max={960} /></Field>
            <Field label="Default task length"><NumIn id="s-def" v={s.defaultDurationMin} on={(v) => set({ defaultDurationMin: Math.max(5, v) })} /></Field>
            <Field label="Home location name"><input id="s-home" className="input" value={s.homeLocation} onChange={(e) => set({ homeLocation: e.target.value })} /></Field>
          </div>
        </section>

        <section className="panel stack">
          <h2>Energy and focus</h2>
          <p className="small muted">High-energy tasks go to high-energy periods; easy tasks are kept out of your peaks.</p>
          <div className="stack tight">
            {s.energy.map((p, i) => (
              <div key={i} className="row nowrap">
                <input id={`en-s-${i}`} type="time" className="input" value={toHHMM(p.start)} onChange={(e) => update((d) => { d.settings.energy[i].start = fromHHMM(e.target.value); })} aria-label="Start" />
                <input id={`en-e-${i}`} type="time" className="input" value={toHHMM(p.end)} onChange={(e) => update((d) => { d.settings.energy[i].end = fromHHMM(e.target.value); })} aria-label="End" />
                <select id={`en-l-${i}`} className="input" value={p.level} onChange={(e) => update((d) => { d.settings.energy[i].level = e.target.value as Energy; })} aria-label="Energy level">
                  <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                </select>
                <button className="iconbtn" onClick={() => update((d) => { d.settings.energy.splice(i, 1); })} aria-label="Remove period"><Icon.trash /></button>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => update((d) => { const last = d.settings.energy.at(-1); d.settings.energy.push({ start: last?.end ?? 9 * 60, end: Math.min(24 * 60, (last?.end ?? 9 * 60) + 120), level: 'medium' }); })}><Icon.plus />Energy period</button></div>
          </div>
          <h3>Protected focus windows</h3>
          <div className="stack tight">
            {s.focusWindows.map((f, i) => (
              <div key={i} className="row nowrap">
                <input id={`fw-s-${i}`} type="time" className="input" value={toHHMM(f.start)} onChange={(e) => update((d) => { d.settings.focusWindows[i].start = fromHHMM(e.target.value); })} aria-label="Start" />
                <input id={`fw-e-${i}`} type="time" className="input" value={toHHMM(f.end)} onChange={(e) => update((d) => { d.settings.focusWindows[i].end = fromHHMM(e.target.value); })} aria-label="End" />
                <button className="iconbtn" onClick={() => update((d) => { d.settings.focusWindows.splice(i, 1); })} aria-label="Remove window"><Icon.trash /></button>
              </div>
            ))}
            <div><button className="btn sm" onClick={() => update((d) => { d.settings.focusWindows.push({ start: 14 * 60, end: 16 * 60 }); })}><Icon.plus />Focus window</button></div>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Commitments and routines</h2>
          <button className="btn primary sm" onClick={() => setEditing({ id: uid('c'), title: '', kind: 'appointment', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 10 * 60, fixed: true, essential: false })}><Icon.plus />Add</button>
        </div>
        <div className="list">
          {[...data.commitments].sort((a, b) => a.start - b.start).map((c) => (
            <div key={c.id} className="item clickable" onClick={() => setEditing(c)}>
              <span className="mono small" style={{ width: '8.5em' }}>{fmtTime(c.start)}–{fmtTime(c.end)}</span>
              <div className="grow">
                <div className="item-title">{c.title}</div>
                <div className="row xs muted">
                  <span>{c.date ?? (c.days.length === 7 ? 'Every day' : c.days.map((d) => DAY_NAMES[d]).join(' '))}</span>
                  <span>{c.kind}</span>
                  {c.location && <span>@ {c.location}</span>}
                  {(c.travelBeforeMin || c.travelAfterMin) && <span>travel {c.travelBeforeMin ?? 0}+{c.travelAfterMin ?? 0}m</span>}
                </div>
              </div>
              {c.essential && <span className="chip ok">Protected</span>}
              <span className={`chip ${c.fixed ? 'tier-obligation' : ''}`}>{c.fixed ? 'Fixed' : 'Movable'}</span>
            </div>
          ))}
        </div>
      </section>
      {editing && <CommitmentEditor value={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function NumIn({ id, v, on, max = 600 }: { id: string; v: number; on: (n: number) => void; max?: number }) {
  return <input id={id} className="input" inputMode="numeric" value={v} onChange={(e) => on(Math.min(max, Number(e.target.value.replace(/\D/g, '')) || 0))} />;
}

function CommitmentEditor({ value, onClose }: { value: Commitment; onClose: () => void }) {
  const data = useApp();
  const [c, setC] = useState(value);
  const exists = data.commitments.some((x) => x.id === c.id);
  const valid = c.title.trim() && c.end > c.start && (c.date || c.days.length);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Commitment">
        <div className="stack" style={{ padding: '1.25rem' }}>
          <h2>{exists ? 'Edit commitment' : 'New commitment'}</h2>
          <div className="fields">
            <Field label="Title"><input id="cm-title" className="input" autoFocus value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} /></Field>
            <Field label="Kind">
              <select id="cm-kind" className="input" value={c.kind} onChange={(e) => setC({ ...c, kind: e.target.value as CommitmentKind })}>
                {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </Field>
            <Field label="Start"><input id="cm-start" type="time" className="input" value={toHHMM(c.start)} onChange={(e) => setC({ ...c, start: fromHHMM(e.target.value) })} /></Field>
            <Field label="End"><input id="cm-end" type="time" className={`input ${c.end <= c.start ? 'invalid' : ''}`} value={toHHMM(c.end)} onChange={(e) => setC({ ...c, end: fromHHMM(e.target.value) })} /></Field>
          </div>
          <Field label="Repeats on" hint="Or set a single date below">
            <div className="days" role="group" aria-label="Days">
              {DAY_NAMES.map((n, i) => <button key={n} type="button" aria-pressed={!c.date && c.days.includes(i)} onClick={() => setC({ ...c, date: undefined, days: c.days.includes(i) ? c.days.filter((x) => x !== i) : [...c.days, i].sort() })}>{n}</button>)}
            </div>
          </Field>
          <div className="fields">
            <Field label="Single date (one-off)"><input id="cm-date" type="date" className="input" value={c.date ?? ''} onChange={(e) => setC({ ...c, date: e.target.value || undefined })} /></Field>
            <Field label="Location"><input id="cm-loc" className="input" value={c.location ?? ''} placeholder="town, campus…" onChange={(e) => setC({ ...c, location: e.target.value.trim() || undefined })} /></Field>
            <Field label="Travel before (min)"><input id="cm-tb" className="input" inputMode="numeric" value={c.travelBeforeMin ?? ''} onChange={(e) => setC({ ...c, travelBeforeMin: Number(e.target.value.replace(/\D/g, '')) || undefined })} /></Field>
            <Field label="Travel after (min)"><input id="cm-ta" className="input" inputMode="numeric" value={c.travelAfterMin ?? ''} onChange={(e) => setC({ ...c, travelAfterMin: Number(e.target.value.replace(/\D/g, '')) || undefined })} /></Field>
            <Field label="Goal">
              <select id="cm-goal" className="input" value={c.goalId ?? ''} onChange={(e) => setC({ ...c, goalId: e.target.value || undefined })}>
                <option value="">None</option>
                {data.goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="row">
            <label className="check"><input type="checkbox" checked={c.fixed} onChange={(e) => setC({ ...c, fixed: e.target.checked })} />Fixed (can’t move)</label>
            <label className="check"><input type="checkbox" checked={c.essential} onChange={(e) => setC({ ...c, essential: e.target.checked })} />Protected life-support (meals, training, people, rest)</label>
          </div>
          <div className="row between">
            {exists ? <ConfirmButton label="Delete" onConfirm={() => { deleteCommitment(c.id); onClose(); }} /> : <span />}
            <div className="row">
              <button className="btn ghost" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={!valid} onClick={() => { upsertCommitment({ ...c, title: c.title.trim() }); toast('Routine saved — refresh your plan to apply it'); onClose(); }}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
