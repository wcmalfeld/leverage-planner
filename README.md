# Leverage Planner

A local-first personal strategy engine. It ranks what you could do by leverage against your own goals, fits the best of it into your real day (sleep, meals, training and people protected), compares that plan with what you'd otherwise do, and learns from daily and weekly reviews.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # 55 engine tests (scoring, scheduling, comparison, review)
npm run build        # production build → dist/
npm run build:single # one self-contained HTML file → dist-single/index.html
```

Requires Node 18+. No API keys, accounts or network services.

## Architecture

```
src/
  domain/     types.ts (data model) · time.ts (date/time helpers)
  engine/     pure, deterministic, unit-tested — no UI imports
    scoring.ts       8-factor weighted leverage score + explanations
    classify.ts      protect / maintain / obligation / optional / reduce, busywork detection
    availability.ts  free windows from routine, commitments, travel, location
    scheduler.ts     greedy placement with re-ranking, energy/focus fit, deps, buffers, breaks, caps
    compare.ts       current vs recommended: allocation, missing work, low-value time, ranked changes
    insights.ts      top-three actions, stop/postpone list, strategic note
    review.ts        plan vs actual, weekly summary, estimate calibration, trends
    advisor.ts       bottleneck detection + "What am I missing?" (StrategyAdvisor interface)
  store/      storage.ts (StorageAdapter) · store.ts · actions.ts · derived.ts · seed.ts
  ui/         App shell, views/, components/ (Timeline, TaskDrawer, …)
```

### Scoring
`score = 100 × Σ(wᵢ·fᵢ)/Σwᵢ × balance`. Factors: goal alignment (importance + rank), impact, compounding, urgency (cost of delay), confidence, time efficiency (deliberately gentle), feasibility (clarity, blockers, repeated postponement), bottleneck. Missing ratings fall back to a neutral 3/5 and are labelled "assumed" in the explanation. `balance` nudges a goal down (max −15%) if it took far more than its share of logged time in the last week. Weights are editable in Priorities, with the rationale for each default.

### Scheduling
1. Waking day minus commitments and travel → free windows (tagged with a location when sandwiched between two commitments at the same place).
2. Locked blocks (anything you moved, resized or accepted) stay exactly in place.
3. Tasks are placed one at a time, re-ranked after each placement (−6 per task already placed for the same goal) so one goal can't take the whole day.
4. Each task gets the best-fitting slot: energy match, focus windows, adjacency to same-goal work, deadline pressure.
5. Prerequisites are pulled in first; long tasks split; buffers follow tasks; a real break follows long focus runs.
6. It stops before eating into your requested open time or daily focused-work cap. Due-today items may override with a warning.
7. Important tasks that don't fit come back with concrete fixes (postpone a lower-ranked block, shorten, split, move to tomorrow).

### Feedback from reviews
- Daily reviews log actual minutes and outcomes; missed tasks roll forward with a postponement count (a signal, not a penalty).
- After 3+ completed tasks per goal, actual/estimate ratios recalibrate durations (clamped 0.8–1.5×).
- Logged time feeds the balance multiplier and the weekly "time vs priority" view.

## Assumptions
- One person, one device; data lives in `localStorage` under `leverage-planner:v1`. Export JSON from Data to back up or move devices.
- Times are local; days run from wake to bedtime (no overnight shifts in the MVP).
- "Current plan" is a typical week you enter by hand plus one-off days.
- Flexible commitments aren't moved automatically; you can drag them for a single day.
- Unclarified inbox items aren't scheduled until they're turned into a concrete next action.

## Limitations
- Scheduling is greedy, not a global optimiser. It's explainable and fast, but not always optimal.
- Location handling is coarse (named places; a 20-minute travel allowance for errands outside home).
- No calendar sync, notifications or multi-device sync yet.
- The "What am I missing?" suggestions are rule-based templates.

## Integration points
- **AI coach:** implement `StrategyAdvisor` (`engine/advisor.ts`) and register it beside `RuleBasedAdvisor`. Only send data after the user configures a provider and consents.
- **Calendar import:** map events to `Commitment` (fixed) and `CurrentBlock` (current plan).
- **Storage/sync:** implement `StorageAdapter` (`store/storage.ts`).
