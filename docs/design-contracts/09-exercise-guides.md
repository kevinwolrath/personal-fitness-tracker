# 09 · Exercise guides

> Tap a prescribed exercise → see how to do it → close → back where I was, with nothing changed.

## Ownership

| Data | Owner | Where |
|---|---|---|
| What the exercise **is**: name, equipment types, instructions, illustrated steps | The exercise library, shipped with the app | `src/exercises/library.json` |
| What to do **today**: sets, reps, seconds, load, short version, substitutions | The workout (plan, 03/08) and the user's exercise configuration (07) | `plans/*.json`, `plan.exercise` |
| Which **equipment** the user has | The exercise configuration (07) | `plan.exercise.equipment` |

An exercise definition never carries a dose, and a workout never carries instructions. The two meet in `buildGuide(prescribedExercise, plan.exercise)` (`src/exercises/guide.ts`, pure), joined by `movement` id.

## Exercise definitions

`library.json` is `{ libraryVersion: 1, exercises: [ExerciseDefinition] }`, validated by `src/exercises/schema.ts` when the app loads (an invalid bundled library fails the tests and the app start, never silently):

| Field | Rule |
|---|---|
| `id` | A movement id (`snake_case`), unique. Matches `session.exercises[].movement`. |
| `name` | Display name, e.g. "Lat pulldown". The workout's own `label` ("Lat pulldown (Fortis)") stays on the Daily Log. |
| `equipment` | Equipment types from 07 (`kettlebell`, `home_gym`, `dumbbells`, …): any one of them will do. |
| `instructions` | 1–8 short cues, in order. |
| `steps` | 0–8 `{ image, caption }`. `image` names a bundled illustration. |

Adding an exercise (goblet squat, one-arm kettlebell row, …) is data only: a definition plus its illustrations. No code changes.

## Illustrations

- App-owned SVG line drawings in `assets/exercises/<image>.svg`, generated from joint poses by `scripts/draw-exercise-illustrations.cjs`. No third-party images, no network, no `href`/`url()`.
- The figure uses `currentColor`, so it follows the theme's ink colour. Equipment and frame colours are fixed in the drawing.
- `npm run build:exercise-assets` bundles them into `src/exercises/illustrations.generated.ts`. Tests fail if it's out of date, if a step names a missing image, or if an image is unused.

## The guide sheet

- **Opens from:** any prescribed exercise row: the "Do this next" card and the workout's details sheet (full and short sessions). The rows are buttons labelled "<label>, <dose>. Show how".
- **Context:** the guide nests inside the sheet that opened it (02's sheet rules), so closing it returns to that sheet, or to the day when opened from the card.
- **Shows:**
  - name;
  - today's dose with the workout's label;
  - the substitution ("Instead of biceps curl…") or caution from 07;
  - the illustrated steps, with the position ("1 / 2");
  - the equipment the user actually has for it ("Fortis home multi-gym", "16 kg and 24 kg kettlebells"), falling back to the definition's types;
  - the instructions.
- **Steps:** a horizontal pager. Swipe, or use the 48 px previous/next buttons. Always opens on step 1. With one step, there are no controls. With none, the guide says "No illustration for this exercise yet."
- **No definition:** the guide still opens with the name, dose and any caution, and says "No guide for this exercise yet."
- **Read-only:** opening, paging or closing the guide never logs, completes or reorders anything.
- **Layout:** fills most of the screen (92 % of the height). On web it renders inside the phone frame, and the responsive sweep (05) covers it at every width.

## Muscle-group inventory, priority and recovery (#56)

Advisory planning only: the app orders and explains, it never blocks a choice or asks for every muscle every day.

**Data, not code.** `src/exercises/inventory.json` holds the approved muscle groups and exercises, each with `primary` and `secondary` muscles, `kind` (`strength` or `conditioning`) and `equipment` (any one type; `[]` means none). `src/exercises/coverage.ts` names no exercise or muscle.
- **Eligible** exercises use the user's configured equipment (`plan.exercise.equipment`). With none configured, only the no-equipment ones are eligible. A limitation of `avoid` removes the movement; `caution` keeps it, flagged.
- **History** comes from session ticks (and whole-workout "done") and from free exercise logs (contract 04). These are disjoint, with stable ids, so nothing counts twice. Conditioning stays separate from strength sessions and suggestions, but its muscle work counts.

**Rules** (`COVERAGE`, tunable; tests pin each):
- **Effective sets:** sets × intensity (light 0.5), scaled down below 6 reps or 20 s per set, so one push-up isn't a set. Primary muscles count 1.0 per effective set, secondary 0.5.
- **Volume window:** the last 7 *training* days. Configured rest days are skipped, so a rest day never makes a muscle overdue.
- **Status**, in this order:
  - **unavailable:** an active sore/injured report, which always wins;
  - **recovering:** inside a recovery window;
  - **green:** at or above the weekly target (6 effective sets);
  - **amber:** from half the target;
  - **red:** below that;
  - **unknown:** red is shown as unknown until history spans 7 days, so nothing is red on first use.
- **Recovery is independent of priority.** Each day's load on a muscle sets a window from that day's last hit: light (≤ 2 effective sets) ~24 h, hard (> 2, or any set marked hard) ~48 h, particularly demanding (≥ 6) ~72 h. Under 0.5 needs none. These are planning defaults, not physiological guarantees.
- **Suggestions** order eligible strength exercises by Σ contribution × need. Need is the share of the target still missing (0.5 when unknown).
  - Order: not done today → not held → score → inventory order.
  - **Held** (listed after, never removed): a primary muscle is recovering or unavailable, or a secondary is unavailable.
- **Scheduled sessions (option C)** keep their exercises; `orderSessionMovements` orders them by the same priority. Session completion and plan behaviour are unchanged.

Not built yet: logging and reporting from the UI, and the silhouette (waiting for approved artwork and layouts).
