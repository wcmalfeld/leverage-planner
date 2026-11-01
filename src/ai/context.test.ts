import { describe, expect, it } from 'vitest';
import { coachContext } from './context';
import { demoData, emptyData } from '../store/seed';

const DATE = '2026-11-02';

describe('coachContext', () => {
  const data = demoData(DATE);
  const text = coachContext(data, DATE);

  it('lists active goals in priority order with their ids', () => {
    const goals = [...data.goals].sort((a, b) => a.order - b.order);
    const positions = goals.map((g) => text.indexOf(`[goal:${g.id}] ${g.name}`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('includes open tasks with ids and leaves completed ones out of the ranking', () => {
    const open = data.tasks.find((t) => t.status !== 'completed' && t.status !== 'deferred')!;
    expect(text).toContain(`[task:${open.id}] ${open.title}`);
    for (const t of data.tasks.filter((t) => t.status === 'completed')) expect(text).not.toContain(`[task:${t.id}]`);
  });

  it('is deterministic so the prompt cache prefix stays stable', () => {
    expect(coachContext(data, DATE)).toBe(text);
  });

  it('handles an empty planner', () => {
    const empty = coachContext({ ...emptyData(DATE), tasks: [] }, DATE);
    expect(empty).toContain('## Open tasks');
    expect(empty).toContain('None.');
  });
});
