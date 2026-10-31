import { useRef, useState, type PointerEvent as RPE } from 'react';
import type { Block, CurrentBlock, Goal, Settings, Tier } from '../../domain/types';
import { fmtDuration, fmtTime, snap } from '../../domain/time';
import { goalColor } from './common';
import { Icon } from './icons';

interface Props {
  blocks: Block[];
  settings: Settings;
  goals: Goal[];
  tiers?: Map<string, Tier>;
  editable?: boolean;
  selectedId?: string;
  onSelect?: (b: Block) => void;
  onTimeChange?: (b: Block, start: number, end: number) => void;
  nowMin?: number;
  pxPerMin?: number;
  showFocus?: boolean;
  label?: string;
}

interface Drag {
  id: string;
  mode: 'move' | 'resize';
  y0: number;
  start: number;
  end: number;
  moved: boolean;
}

export function Timeline({ blocks, settings, goals, tiers, editable, selectedId, onSelect, onTimeChange, nowMin, pxPerMin = 1.05, showFocus = true, label }: Props) {
  const startMin = Math.floor(settings.wake / 60) * 60;
  const endMin = Math.ceil(Math.max(settings.sleep, ...blocks.map((b) => b.end)) / 60) * 60;
  const height = (endMin - startMin) * pxPerMin;
  const y = (m: number) => (m - startMin) * pxPerMin;
  const [drag, setDrag] = useState<Drag | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const goalsById = new Map(goals.map((g) => [g.id, g]));

  const pos = (b: Block) => (drag && drag.id === b.id ? { start: drag.start, end: drag.end } : b);
  const solid = blocks.filter((b) => b.type !== 'buffer');
  const overlapping = new Set<string>();
  for (const a of solid) for (const b of solid) {
    if (a === b || a.type !== 'task') continue;
    const pa = pos(a), pb = pos(b);
    if (pa.start < pb.end && pb.start < pa.end) overlapping.add(a.id);
  }

  const draggable = (b: Block) => editable && (b.type === 'task' || (b.type === 'commitment' && !b.fixed)) && b.status !== 'done';

  const down = (e: RPE, b: Block, mode: Drag['mode']) => {
    if (!draggable(b)) {
      onSelect?.(b);
      return;
    }
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    setDrag({ id: b.id, mode, y0: e.clientY, start: b.start, end: b.end, moved: false });
  };
  const move = (e: RPE) => {
    if (!drag) return;
    const b = blocks.find((x) => x.id === drag.id)!;
    const dm = snap((e.clientY - drag.y0) / pxPerMin);
    if (Math.abs(e.clientY - drag.y0) < 3 && !drag.moved) return;
    if (drag.mode === 'move') {
      const len = b.end - b.start;
      const s = Math.min(Math.max(b.start + dm, startMin), endMin - len);
      setDrag({ ...drag, start: s, end: s + len, moved: true });
    } else {
      const e2 = Math.min(Math.max(b.end + dm, b.start + 10), endMin);
      setDrag({ ...drag, end: e2, moved: true });
    }
  };
  const up = () => {
    if (!drag) return;
    const b = blocks.find((x) => x.id === drag.id)!;
    if (drag.moved && (drag.start !== b.start || drag.end !== b.end)) onTimeChange?.(b, drag.start, drag.end);
    else onSelect?.(b);
    setDrag(null);
  };
  const key = (e: React.KeyboardEvent, b: Block) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(b);
    }
    if (!draggable(b) || !onTimeChange) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); onTimeChange(b, b.start, Math.max(b.start + 10, b.end - step)); }
    else if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); onTimeChange(b, b.start, b.end + step); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); onTimeChange(b, b.start - step, b.end - step); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); onTimeChange(b, b.start + step, b.end + step); }
  };

  const hours: number[] = [];
  for (let m = startMin; m <= endMin; m += 60) hours.push(m);

  return (
    <div className="timeline" aria-label={label ?? 'Schedule timeline'}>
      <div className="tl-hours" style={{ height }}>
        {hours.map((m) => (
          <span key={m} className="tl-hour" style={{ top: y(m) }}>{fmtTime(m)}</span>
        ))}
      </div>
      <div className="tl-track" ref={trackRef} style={{ height }} onPointerMove={move} onPointerUp={up} onPointerCancel={() => setDrag(null)}>
        {hours.map((m) => <div key={m} className="tl-grid" style={{ top: y(m) }} />)}
        {settings.energy.map((p, i) => (
          <div key={i} className={`tl-energy ${p.level}`} style={{ top: y(Math.max(p.start, startMin)), height: Math.max(0, (Math.min(p.end, endMin) - Math.max(p.start, startMin)) * pxPerMin) }} title={`${p.level} energy`} />
        ))}
        {showFocus && settings.focusWindows.map((f, i) => (
          <div key={i} className="tl-focus" style={{ top: y(f.start), height: (f.end - f.start) * pxPerMin }} />
        ))}
        {blocks.map((b) => {
          const p = pos(b);
          const h = (p.end - p.start) * pxPerMin;
          const g = goalsById.get(b.goalIds[0]);
          const tier = b.taskId ? tiers?.get(b.taskId) : undefined;
          const cls = [
            'blk',
            b.type,
            b.type === 'commitment' ? (b.fixed ? 'fixed' : 'flexible') : '',
            b.essential && b.type === 'commitment' ? 'essential' : '',
            b.type === 'task' ? b.status : '',
            tier === 'protect' ? 'protect' : '',
            selectedId === b.id ? 'selected' : '',
            drag?.id === b.id ? 'dragging' : '',
            overlapping.has(b.id) ? 'overlap' : '',
          ].join(' ');
          if (b.type === 'buffer')
            return h >= 12 ? <div key={b.id} className={cls} style={{ top: y(p.start), height: h }} aria-hidden="true" /> : null;
          const interactive = b.type === 'task' || b.type === 'commitment';
          return (
            <div
              key={b.id}
              className={cls}
              style={{ top: y(p.start), height: Math.max(h, 14), ['--gc' as string]: goalColor(g) }}
              onPointerDown={interactive ? (e) => down(e, b, 'move') : undefined}
              onKeyDown={interactive ? (e) => key(e, b) : undefined}
              tabIndex={interactive ? 0 : undefined}
              role={interactive ? 'button' : undefined}
              aria-label={`${b.title}, ${fmtTime(p.start)} to ${fmtTime(p.end)}${b.type === 'commitment' ? (b.fixed ? ', fixed' : ', flexible') : ''}`}
            >
              {b.type === 'break' ? (
                h >= 16 && <span className="bm">Break · {fmtDuration(p.end - p.start)}</span>
              ) : (
                <>
                  <span className="bt">{b.title}{b.chunk ? ` (${b.chunk.index}/${b.chunk.of})` : ''}</span>
                  {h >= 40 && (
                    <span className="bm">
                      {fmtTime(p.start)}–{fmtTime(p.end)} · {fmtDuration(p.end - p.start)}
                      {g && b.type === 'task' ? ` · ${g.name}` : ''}
                    </span>
                  )}
                  {h >= 58 && b.note && <span className="bm">{b.note}</span>}
                </>
              )}
              {b.type === 'task' && (
                <span className="icons">
                  {b.status === 'done' ? <Icon.check /> : b.locked ? <Icon.lock /> : null}
                </span>
              )}
              {draggable(b) && b.type === 'task' && <span className="handle" onPointerDown={(e) => down(e, b, 'resize')} aria-hidden="true" />}
            </div>
          );
        })}
        {nowMin !== undefined && nowMin >= startMin && nowMin <= endMin && <div className="tl-now" style={{ top: y(nowMin) }} />}
      </div>
    </div>
  );
}

/** Read-only timeline for the "current plan" side of Compare. */
export function currentToBlocks(cur: CurrentBlock[], date: string): Block[] {
  return cur.map((c) => ({
    id: c.id,
    date,
    start: c.start,
    end: c.end,
    title: c.title,
    type: 'task' as const,
    taskId: c.taskId,
    goalIds: c.goalId ? [c.goalId] : [],
    status: c.value === 'distraction' ? ('skipped' as const) : ('accepted' as const),
    fixed: false,
    locked: false,
  }));
}

export function TimelineLegend() {
  return (
    <div className="legend">
      <span><i style={{ background: 'var(--glow-soft)', borderLeft: '3px solid var(--glow)' }} />High-leverage</span>
      <span><i style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: '3px solid var(--accent)' }} />Flexible task</span>
      <span><i style={{ background: 'var(--fixed-soft)', borderLeft: '3px solid var(--fixed)' }} />Fixed commitment</span>
      <span><i style={{ border: '1px dashed var(--fixed)' }} />Movable routine</span>
      <span><i style={{ border: '1px dotted var(--accent)' }} />Break</span>
      <span><i style={{ background: 'repeating-linear-gradient(135deg, transparent 0 3px, var(--accent-soft) 3px 4px)' }} />Focus window</span>
    </div>
  );
}
