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
