import { useState } from 'react';
import type { ISODate, Task } from '../../domain/types';
import { pauseTask } from '../../store/actions';
import { fmtDateShort } from '../../domain/time';
import { toast } from './common';

/**
 * "Ready to resume": before you switch away from unfinished work, write where you
 * stopped and the next step. It frees attention for what comes next (Leroy & Glomb 2018).
 */
export function PauseForm({ task, date, minutes, onDone }: { task: Task; date: ISODate; minutes: number; onDone: () => void }) {
  const [note, setNote] = useState(task.resumeNote?.text ?? '');
  const [min, setMin] = useState(String(Math.max(0, minutes)));
  return (
    <form className="stack tight" onSubmit={(e) => {
      e.preventDefault();
      pauseTask(task.id, date, note, Number(min) || 0);
      toast('Saved — you’ll see this note next time');
      onDone();
    }}>
      <label className="field">
        <span>Where did you stop, and what’s the very next step?</span>
        <textarea id={`pause-${task.id}`} className="input" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Drafted 2 of 4 sections. Next: pull the numbers for section 3." />
      </label>
      <div className="row nowrap">
        <label className="xs muted" htmlFor={`pause-min-${task.id}`}>Minutes worked</label>
        <input id={`pause-min-${task.id}`} className="input" style={{ width: 76 }} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} />
        <span className="grow" />
        <button type="button" className="btn sm ghost" onClick={onDone}>Cancel</button>
        <button className="btn sm primary" disabled={!note.trim()}>Save & pause</button>
      </div>
    </form>
  );
}

/** Shows a saved resume note, if any. */
export function ResumeNote({ task, compact }: { task?: Task; compact?: boolean }) {
  if (!task?.resumeNote) return null;
  return (
    <div className={`resume-note${compact ? ' compact' : ''}`}>
      <span className="label">Pick up from · {fmtDateShort(task.resumeNote.date)}</span>
      <span>{task.resumeNote.text}</span>
    </div>
  );
}

/** What to do first when you sit down to it: where you left off, else the planned first step. */
export function NextStep({ task, compact }: { task?: Task; compact?: boolean }) {
  if (task?.resumeNote) return <ResumeNote task={task} compact={compact} />;
  if (!task?.firstStep) return null;
  return (
    <div className={`resume-note first-step${compact ? ' compact' : ''}`}>
      <span className="label">First step</span>
      <span>{task.firstStep}</span>
    </div>
  );
}
