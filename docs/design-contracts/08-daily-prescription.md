# 08 · Daily prescription and next action

> Open app → see what I should do now → do it → tick it off → app tells me what's next.

The app executes the configured plan deterministically, with no AI call when the home screen opens. Five layers, each a separate piece of code. The UI only renders their output.

```
FitnessConfig (07: profile, exercise limitations/substitutions, …)
   ↓
Plan (03: activities, requirements, windows, sessions)          plans/*.json, edited via 07
   ↓  prescribeDay(plan, date, records)                         src/prescription/prescribe.ts
DailyPrescription (items for one date, with state)
   ↓  completion.advance / setDone / setSkipped                 src/prescription/completion.ts
CompletionLog (state + append-only events + day snapshot)       TrackingStore.logCompletion
   ↓  nextAction(prescription, nowMinutes)                      src/prescription/nextAction.ts
NextAction
```

## Plan fields (formatVersion 2, all optional)

| Field | On | Meaning |
|---|---|---|
| `purpose` | activity, requirement | What it's for: `strength`, `conditioning_high_intensity`, `conditioning_low_intensity`, `walking`, `mobility`, `nutrition`, `supplement`, `recovery`, `habit`, `other` |
| `when` | activity, requirement | Broad window instead of an exact `time`: `morning`, `lunch`, `afternoon`, `evening`, `anytime`. Not both. |
| `after` | activity | Activity ids to resolve (done or skipped) first. Cycles are rejected. |
| `session` | activity | `{ minutes?, exercises: [{ movement, label?, sets?, reps?, seconds?, loadKg?, notes? }], short?: { minutes?, exercises } }` |
| `satisfies` | activity | A requirement id: this activity is **one alternative** for that requirement |
| `requirements` | plan | `[{ id, label, purpose, detail?, required?, when? / time? }]`. Each must have at least one activity that satisfies it. |

The AI configuration protocol (07) edits all of these. Requirements are a `schedule` field, and activity fields ride along in `schedule.activities` and `nutrition.meals`. Upgrading a configured plan to the shipped prescription is `fixtures/config/daily-prescription.update.json`.

## Prescription rules (`prescribeDay`, pure)

- **Inputs:** the plan's activities for the date, resolved by day type and weekday as in 03.
- **Alternatives:** activities with `satisfies` collapse into **one requirement item** listing its `options`. Any one option done satisfies the requirement, and the other options become "not needed". A count option counts only at its target, so a part-done VR boxing session doesn't satisfy it.
  - The scheduler knows purposes and requirements, never activity names. There is no VR-boxing logic.
- **States:** `pending`, `partial` (count started), `done` or `skipped`. Skipping a requirement skips it as a unit.
- **Windows** (minutes since local midnight):
  - Exact `time`: from 30 min before until its duration (at least 60 min) has passed.
  - Day parts: morning 06:00–11:00, lunch 11:00–14:00, afternoon 14:00–17:30, evening 17:30–22:00.
  - Anytime: the whole day.
  - A requirement without its own window uses its earliest option's window.
- **Sessions:** each exercise has the user's exercise configuration (07) applied.
  - `avoid` with a substitute: replaced by the first allowed substitute, marked "instead of …".
  - `avoid` with no substitute: flagged.
  - `caution`: flagged.
  - The short version is processed the same way.
- **Order and progress:** items are ordered by window start, then plan order. Progress counts required, non-skipped items, with a requirement counting as one.

## Next action (`nextAction`, pure)

- **Candidates:** items that are `pending` or `partial` and whose `after` dependencies are resolved.
- **Rank:**
  1. required, window open now
  2. required, anytime
  3. required, overdue
  4. optional, open now
  5. optional, anytime
  6. optional, overdue
  7. upcoming (earliest first)
- **Ties:** window start, then plan order.
- **Status shown:** `now` / `anytime` / `overdue` / `later`.

Completing, undoing or skipping anything recomputes it immediately. The time is re-read every minute and when the app returns to the foreground.

## Completion log (contract 04)

- `activity_log`: the current state per date and activity, with `updatedAt` as the completion time, `variant` (`full`/`short`) and `requirementId` (which requirement an alternative satisfied).
- `completion_event`: **append-only** (`complete`, `progress`, `undo`, `skip`, `restore`), each with a timestamp, label, purpose, requirement and variant. Undo adds an event and never deletes history.
- `day_snapshot`: what was prescribed that date (items, options, session exercises with substitutions, plan revision). It's written on every completion action, so a later plan edit can't rewrite what was prescribed.
- Together they answer: what was prescribed, what was completed and when, what was skipped, and whether an alternative or the short version was used. All three are written in one atomic `logCompletion` call, and the export includes the events and snapshots.

## Home screen (Daily Log, today)

1. **Do this next** card: the next action's label and window ("Now · 8:30 am", "Anytime today", "Was due 12:00 pm", "Next up at …"), its session exercises, or for a meal what to prepare: ingredients with amounts and measures, how to make it, and energy/protein (#26, from the plan). Then one-tap completion. Count items show "Add round · 2 of 3", and requirements get a button per alternative. "Short version, skip and more" opens the item sheet.
2. The day grouped by part of day: **Morning / Midday / Afternoon / Evening / Anytime today**. Requirements render as one row with tappable alternatives, and the next item has an accent bar.
3. The item sheet: full and short sessions, **Done (full session)**, **Done (short version, N min)**, alternatives, skip and restore.

The card is shown for today only. Past dates are correctable as before, and future dates are view-only (04). Exercise-level ticking isn't implemented: completion is per session, and `session.exercises` leaves room to add it.
