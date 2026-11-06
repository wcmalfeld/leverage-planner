/**
 * Start nudges: when a block begins, say what it is and the very first action.
 * Starting is where plans most often fail; naming the first step removes the
 * decision (implementation intentions, Gollwitzer 1999).
 */
import type { Block, Minutes, Task } from '../domain/types';
import { fmtTime } from '../domain/time';

/** How long after a block starts a nudge is still worth showing. */
export const NUDGE_GRACE_MIN = 10;

export function dueNudges(blocks: Block[], nowMin: Minutes, leadMin: Minutes, sent: Set<string>): Block[] {
  return blocks.filter(
    (b) =>
      (b.type === 'task' || b.type === 'shutdown') &&
      (b.status === 'proposed' || b.status === 'accepted') &&
      !sent.has(b.id) &&
      b.start - leadMin <= nowMin &&
      nowMin < Math.min(b.end, b.start + NUDGE_GRACE_MIN),
  );
}

export interface NudgeText {
  title: string;
  /** "First step", "Pick up from" or "Done means". */
  label?: string;
  step?: string;
  body: string;
}

export function nudgeText(b: Block, task: Task | undefined, nowMin: Minutes): NudgeText {
  const when = b.start > nowMin ? `At ${fmtTime(b.start)}` : 'Now';
  const title = `${when}: ${b.type === 'shutdown' ? 'Shutdown review' : b.title}`;
  let label: string | undefined;
  let step: string | undefined;
  if (b.type === 'shutdown') {
    label = 'First step';
    step = 'Open Review, tick off what got done, and give each unfinished task a next step and a day.';
  } else if (task?.resumeNote) {
    label = 'Pick up from';
    step = task.resumeNote.text;
  } else if (task?.firstStep) {
    label = 'First step';
    step = task.firstStep;
  } else if (task?.expectedResult) {
    label = 'Done means';
    step = task.expectedResult;
  }
  const body = `${step ? `${label}: ${step}` : 'No first step set: decide the very first action before you start.'} (until ${fmtTime(b.end)})`;
  return { title, label, step, body };
}
