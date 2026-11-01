import { useState } from 'react';
import type { Goal, ISODate } from '../../domain/types';
import { useApp } from '../../store/store';
import { addDays, DAY_NAMES, dayOfWeek, fmtDateShort, fmtDuration, fmtTime, parseISO, todayISO } from '../../domain/time';
import { addMonths, calendarDay, monthWeeks, weekDates, type CalendarItem } from '../../engine/calendar';
import { goalColor } from '../components/common';
import { Icon } from '../components/icons';
import { useUI } from '../App';

type Mode = 'week' | 'month';

const MODE_KEY = 'leverage-planner:calendar-mode';
const MONTH_PREVIEW = 3;
const ALL_DAY_LABEL: Partial<Record<CalendarItem['kind'], string>> = { deadline: 'Due', milestone: 'Milestone', 'goal-target': 'Goal' };

function savedMode(): Mode {
  try { return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'week'; } catch { return 'week'; }
}

export function CalendarView() {
  const data = useApp();
  const today = todayISO();
  const [mode, setModeState] = useState<Mode>(savedMode);
  const [anchor, setAnchor] = useState(today);
  const goalsById = new Map(data.goals.map((g) => [g.id, g]));

  const setMode = (m: Mode) => {
    setModeState(m);
    try { localStorage.setItem(MODE_KEY, m); } catch { /* preference only */ }
  };
  const step = (n: number) => setAnchor(mode === 'week' ? addDays(anchor, 7 * n) : addMonths(anchor, n));
  const week = weekDates(anchor);
  const label =
    mode === 'week'
      ? `${fmtDateShort(week[0])} – ${fmtDateShort(week[6])}`
      : parseISO(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <>
      <header className="page-head">
        <div>
          <div className="eyebrow">Calendar</div>
          <h1>{label}</h1>
          <p>Plans, routine, deadlines and milestones across days. Days you haven’t planned yet show your routine. Click a day to open its plan.</p>
        </div>
        <div className="row">
          <div className="seg" role="group" aria-label="Calendar view">
            {(['week', 'month'] as Mode[]).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'week' ? 'Week' : 'Month'}</button>)}
          </div>
          <button className="btn ghost sm" onClick={() => step(-1)} aria-label={`Previous ${mode}`}>←</button>
          <button className="btn sm" onClick={() => setAnchor(today)}>Today</button>
          <button className="btn ghost sm" onClick={() => step(1)} aria-label={`Next ${mode}`}>→</button>
        </div>
      </header>

      {mode === 'week' ? (
        <div className="cal-week">
          {week.map((date) => <WeekDay key={date} date={date} today={today} goalsById={goalsById} />)}
        </div>
      ) : (
        <section className="panel cal-month" aria-label={label}>
          {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className="cal-dow">{DAY_NAMES[d]}</div>)}
          {monthWeeks(anchor).flat().map((date) => (
            <MonthDay key={date} date={date} today={today} inMonth={date.slice(0, 7) === anchor.slice(0, 7)} goalsById={goalsById} />
          ))}
        </section>
      )}
      <CalendarLegend />
    </>
  );
}

function WeekDay({ date, today, goalsById }: { date: ISODate; today: ISODate; goalsById: Map<string, Goal> }) {
  const data = useApp();
  const { openPlan, openTask } = useUI();
  const day = calendarDay(data, date);
  const allDay = day.items.filter((i) => i.start === undefined);
  const timed = day.items.filter((i) => i.start !== undefined);

  return (
    <section className={`panel cal-day${date === today ? ' today' : ''}${date < today ? ' past' : ''}`}>
      <button className="cal-day-head" onClick={() => openPlan(date)} aria-label={`Open plan for ${fmtDateShort(date)}`}>
        <span className="eyebrow">{DAY_NAMES[dayOfWeek(date)]}</span>
        <span className="cal-num">{parseISO(date).getDate()}</span>
      </button>
      {allDay.map((i) => <AllDayItem key={i.id} item={i} />)}
      <div className="cal-items">
        {timed.map((i) => (
          <button
            key={i.id}
            className={`cal-item ${i.kind}${i.done ? ' done' : ''}${i.essential ? ' essential' : ''}`}
            style={{ borderLeftColor: goalColor(goalsById.get(i.goalIds[0] ?? '')) }}
            onClick={() => (i.taskId ? openTask(i.taskId) : openPlan(date))}
          >
            <span className="mono xs faint">{fmtTime(i.start!)}</span>
            <span className="cal-item-title">{i.title}</span>
          </button>
        ))}
        {!timed.length && !allDay.length && <span className="xs faint">Nothing scheduled</span>}
      </div>
      <div className="cal-day-foot xs faint">
        {day.planned ? (
          <>{day.plannedTaskMin ? `${fmtDuration(day.plannedTaskMin)} of tasks planned` : 'Planned · no tasks'}</>
        ) : date >= today ? (
          <button className="btn sm ghost" onClick={() => openPlan(date)}><Icon.plan />Plan this day</button>
        ) : (
          'No plan'
        )}
      </div>
    </section>
  );
}

function MonthDay({ date, today, inMonth, goalsById }: { date: ISODate; today: ISODate; inMonth: boolean; goalsById: Map<string, Goal> }) {
  const data = useApp();
  const { openPlan } = useUI();
  const day = calendarDay(data, date);
  // Protected routine (meals, sleep…) repeats every day, so the month grid leaves it out.
  // All-day items come first, so deadlines and milestones win the limited space.
  const visible = day.items.filter((i) => !(i.kind === 'commitment' && i.essential));
  const shown = visible.slice(0, MONTH_PREVIEW);
  const more = visible.length - shown.length;

  return (
    <button
      className={`cal-cell${inMonth ? '' : ' outside'}${date === today ? ' today' : ''}`}
      onClick={() => openPlan(date)}
      aria-label={`${fmtDateShort(date)}: ${day.items.length} items. Open plan.`}
    >
      <span className="row nowrap between">
        <span className="cal-num sm">{parseISO(date).getDate()}</span>
        {day.planned && <span className="dot" style={{ color: 'var(--accent)' }} title="Planned" />}
      </span>
      {shown.map((i) => (
        <span key={i.id} className={`cal-chip ${i.kind}${i.done ? ' done' : ''}`} style={{ borderLeftColor: goalColor(goalsById.get(i.goalIds[0] ?? '')) }}>
          {ALL_DAY_LABEL[i.kind] ? `${ALL_DAY_LABEL[i.kind]}: ` : ''}{i.title}
        </span>
      ))}
      {more > 0 && <span className="xs faint">+{more} more</span>}
    </button>
  );
}

function AllDayItem({ item }: { item: CalendarItem }) {
  const { openTask, go } = useUI();
  return (
    <button className={`cal-allday ${item.kind}${item.done ? ' done' : ''}`} onClick={() => (item.taskId ? openTask(item.taskId) : go('goals'))}>
      <Icon.flag />
      <span><strong>{ALL_DAY_LABEL[item.kind]}</strong> {item.title}</span>
    </button>
  );
}

function CalendarLegend() {
  return (
    <p className="xs faint row">
      <span className="cal-allday deadline legend"><Icon.flag />Due date</span>
      <span className="cal-allday milestone legend"><Icon.flag />Milestone or goal target</span>
      <span>Left edge colour = goal</span>
    </p>
  );
}
