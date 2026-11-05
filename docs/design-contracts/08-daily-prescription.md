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
  - Exact `time`: **due** from its lead time before the time until its duration (at least 60 min) has passed (#51). Lead time precedence: item `leadMinutes` > plan `timing.leadMinutes[kind]` > format default (meal 15, habit 15, exercise 30; 03). A requirement uses its own `leadMinutes`, else the lead for its alternatives' kind.
  - Day parts: morning 06:00–11:00, lunch 11:00–14:00, afternoon 14:00–17:30, evening 17:30–22:00.
  - Anytime: the whole day.
  - A requirement without its own window uses its earliest option's window.
- **Sessions:** each exercise has the user's exercise configuration (07) applied.
  - `avoid` with a substitute: replaced by the first allowed substitute, marked "instead of …".
  - `avoid` with no substitute: flagged.
  - `caution`: flagged.
  - The short version is processed the same way.
- **Order and progress:** items are ordered by scheduled time (the exact time, or the day part's start; anytime first in sort, shown last), then plan order. Lead times never reorder the list. Progress counts required, non-skipped items, with a requirement counting as one.

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
- **Ties:** when it becomes due, then scheduled time, then plan order.
- **Status shown:** `now` / `anytime` / `overdue` / `later`.
- **Due vs upcoming (#51):** `now`, `anytime` and `overdue` are **due**. `later` is only chosen when nothing is due, and is a preview: it never shows completion controls or a meal's details.

Completing, undoing or skipping anything recomputes it immediately. The local date and time are read together, at every minute boundary (including midnight, so the day rolls over while the app is open) and when the app returns to the foreground.

## Completion log (contract 04)

- `activity_log`: the current state per date and activity, with `updatedAt` as the completion time, `variant` (`full`/`short`) and `requirementId` (which requirement an alternative satisfied).
- `completion_event`: **append-only** (`complete`, `progress`, `undo`, `skip`, `restore`), each with a timestamp, label, purpose, requirement and variant. Undo adds an event and never deletes history.
- `day_snapshot`: what was prescribed that date (items, options, session exercises with substitutions, plan revision). It's written on every completion action, so a later plan edit can't rewrite what was prescribed.
- Together they answer: what was prescribed, what was completed and when, what was skipped, and whether an alternative or the short version was used. All three are written in one atomic `logCompletion` call, and the export includes the events and snapshots.

## Home screen (Daily Log, today)

1. **Up next / Do this next** (one slot, content layer):
   - **Nothing due:** a compact ink **Up next** card: "Up next · 12:00 pm", the label, "In 4 h 30 min · detail", and **Details**, which opens the item sheet (meal details, early Done, Skip). No meal checklist and no Done on the card. It's small enough that Weight and the measurements stay on screen. No second "Up next" is shown while something is due.
   - **Due:** the full **Do this next** card: the label and window ("In 15 min · 12:00 pm" inside the lead time, "Now · 8:30 am", "Anytime today", "Was due 12:00 pm"). A **session** gets the workout card (see Exercise checklist below). For a meal it shows what to prepare: ingredients with amounts and measures, how to make it, and energy/protein (#26, from the plan). Then one-tap completion. Count items show "Add round · 2 of 3", and requirements get a button per alternative. "Short version, skip and more" opens the item sheet.
2. The day grouped by part of day: **Morning / Midday / Afternoon / Evening / Anytime today**. Requirements render as one row with tappable alternatives, and the next item has an accent bar.
3. The item sheet: for a session, the Full/Short switch and the exercise checklist (ticks on any editable day, so past days can be corrected), plus **Mark whole workout done** as a retrospective override; alternatives, skip and restore.

The card is shown for today only. Past dates are correctable as before, and future dates are view-only (04).

## Exercise checklist (#28)

A session (strength workout) is completed **exercise by exercise**, and it stays **one item** in the day's progress.

**Version**
- Full or short is an **explicit choice** (the Full/Short switch), defaulting to full. It's never inferred from ticks, because the short version is usually a subset of the full one: ticking those exercises mid-way through a full session must not complete it.
- Each version keeps its own ticks, because their doses differ.
- Switching when the current version has ticks asks first ("Switch to the short version?").

**Completing and reopening**
- Ticking the last required exercise of the chosen version completes the workout, recorded with that variant.
- Unticking one of a completed workout reopens it.
- An exercise marked *avoid* with no substitute is shown but isn't required.

**Records**
- `activity_log.exercisesDone` holds keys `<variant>:<index>:<movement>`. `variant` is the chosen version, even while pending.
- Each tick is a `tick`/`untick` event (label = the exercise); a version change is `switch`; completing and reopening are `complete`/`undo`. All are append-only.
- Pure rules live in `src/prescription/exercises.ts`.

**Workout card** (option C, chosen in #28)
- **Collapsed** (the default) shows only:
  - the workout's name;
  - progress ("35 min · 2 of 5 exercises");
  - the **next exercise** with its own tick and ⓘ.

  You can train without expanding: tick it, and the next one fades in. Keep this state minimal; don't add controls or copy to it.
- **Expanded** (⌄): the Full/Short switch, every exercise (done ones stay visible, struck through, with the next one highlighted), and "Skip and more". Expanded or collapsed is remembered per day and item for the app session.
- **No whole-workout Done on the card.** Ticks are the way to train. Marking the whole workout done stays available from the day-list row and the item sheet as a manual override. It then shows every exercise of its version as done, and unticking one makes the rest explicit.
- **Finishing.** When the last exercise is ticked, the card holds **"Strength workout complete · 5 of 5 exercises ✓"** for about 4 seconds, or until "What's next ›", then "Do this next" moves on.
- **Guide.** ⓘ (or the exercise's name) opens the exercise guide (09) and never changes completion.
- **Touch targets.** Every tick target is at least 48 dp.
