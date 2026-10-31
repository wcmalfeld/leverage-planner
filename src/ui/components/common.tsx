import { useEffect, useState, type ReactNode } from 'react';
import type { Goal, Rating, Tier } from '../../domain/types';
import { TIER_INFO } from '../../engine/classify';
import { Icon } from './icons';

export const goalColor = (g?: Goal) => (g ? `var(--g-${g.color})` : 'var(--faint)');

export function GoalTag({ goal }: { goal?: Goal }) {
  if (!goal) return <span className="goal-tag faint">No goal</span>;
  return (
    <span className="goal-tag">
      <span className="dot" style={{ background: goalColor(goal) }} />
      {goal.name}
    </span>
  );
}

export function TierChip({ tier, title }: { tier: Tier; title?: string }) {
  return (
    <span className={`chip tier-${tier}`} title={title ?? TIER_INFO[tier].advice}>
      {TIER_INFO[tier].short}
    </span>
  );
}

export function RatingInput({ value, onChange, label }: { value?: number; onChange: (v: Rating | undefined) => void; label: string }) {
  return (
    <div className="rating" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          aria-label={`${label} ${n} of 5`}
          onClick={() => onChange(value === n ? undefined : (n as Rating))}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T | undefined; options: { v: T; l: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.v} type="button" aria-pressed={value === o.v} onClick={() => onChange(o.v)}>
          {o.l}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <h2 className="grow" style={{ fontSize: '1.05rem' }}>{title}</h2>
          {actions}
          <button className="iconbtn" onClick={onClose} aria-label="Close">
            <Icon.x />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'crit'; children: ReactNode }) {
  const Ic = kind === 'info' ? Icon.info : Icon.alert;
  return (
    <div className={`notice ${kind}`} role={kind === 'crit' ? 'alert' : undefined}>
      <Ic />
      <div className="grow">{children}</div>
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

/** Inline two-step confirm (the viewer can't show native confirm dialogs). */
export function ConfirmButton({ label, confirm = 'Confirm', onConfirm, className = 'btn ghost danger sm' }: { label: ReactNode; confirm?: string; onConfirm: () => void; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  return armed ? (
    <span className="row">
      <button className="btn sm danger" onClick={() => { setArmed(false); onConfirm(); }}>{confirm}</button>
      <button className="btn ghost sm" onClick={() => setArmed(false)}>Cancel</button>
    </span>
  ) : (
    <button className={className} onClick={() => setArmed(true)}>{label}</button>
  );
}

let toastSet: ((s: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSet?.(msg);
}
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSet = setMsg;
    return () => { toastSet = null; };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
export const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();
