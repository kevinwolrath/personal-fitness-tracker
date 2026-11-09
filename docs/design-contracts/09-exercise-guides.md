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

Adding an exercise is a library definition plus bundled illustrations and a static asset registry entry; no new screen or business rules.

## Illustrations

- Production guides select the profile's established Body Anvil hero: male/female explicitly, neutral for absent/other/unknown values, using the same rule as muscle maps. A step uses its existing exercise pose only when the manifest character matches. Where a matching pose is missing, the approved front portrait is clearly labelled as a portrait with an exercise-pose-unavailable message; it is not a movement demonstration. The current assets have only one character's sequence per exercise. See `docs/design/profile-exercise-heroes/README.md` for the coverage limitation.
- Offline JPEG steps live under `assets/exercises/heroes/`. `manifest.json` records stable IDs, movements, character assignments and step order. `src/exercises/heroIllustrations.ts` uses literal static `require` calls so Metro ships each image on web, iOS and Android. No remote URL, API key or image-generation service is required at runtime.
- Every tracked inventory movement has two illustrated steps and instructions; the existing cable-row guide is retained too. Doses stay owned by workouts/configuration, never the artwork. Conditioning illustrations do not turn time-based activity into strength logging.
- Images use `contain` in the existing 4:3 illustration frame, with no distortion or body cropping. The heroes retain their charcoal/orange costume and dark background in both selectable themes. Captions and instructions remain accessible text outside the image.
- Tests check inventory/library/registry coverage, unique step assets, file signatures/size, all three heroes, native paging and browser loading. Source prompts and processing provenance are in `docs/design/hero-exercises/`.
- Legacy SVG source assets and their generator remain in the repository for provenance; production guides no longer render the generic figures.

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
- **History** (`src/exercises/state.ts`, the last 60 days) comes from three sources. They're disjoint and have stable ids, so nothing counts twice:
  - session ticks (and whole-workout "done"), with doses from that day's snapshot, else the plan in effect;
  - plan activities that name a `movement` (formatVersion 7), for example VR boxing: rounds done (even part-way), or the planned duration once a check is done; skipped counts nothing;
  - exercises logged on their own (contract 04).
- **Conditioning** stays separate from strength sessions and suggestions, but its muscle work counts. Legacy movements outside the inventory (e.g. `cable_row`) keep their data and simply add no muscle history.

**Rules** (`COVERAGE`, tunable; tests pin each):
- **Effective sets:**
  - **Strength:** sets × intensity (light 0.5), scaled down below 6 reps or 20 s per set, so one push-up isn't a set.
  - **Conditioning** has its own model, by time: minutes × 0.15 × intensity. Rounds without a time count 3 minutes each, so a 3-minute boxing round is about 0.45 of a set, never a hard set.
  - Primary muscles count 1.0 per effective set, secondary 0.5.
- **Rest days** come only from `plan.exercise.restDays` (formatVersion 7; the seed rests on Friday). They're never inferred from the schedule.
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
- **Scheduled sessions (option C)** keep their exercises. On Today, `sessionExerciseOrder` orders them by the same priority:
  - Plan order until history spans 7 days.
  - Exercises the inventory doesn't know keep their slot.
  - The order uses history **before today**, so it never reshuffles mid-workout.
  - It's display order only: exercise keys, ticks and session completion are unchanged.
- **Logging:** `logExercise` (inventory movements, whole sets, any day including rest days) and `reportMuscle` / `clearMuscleReport`. On screen: Today's workout (contract 08) ticks with one tap, and the coverage sheet's log form records a different dose.
- **Default doses:** every strength entry has a `defaultDose` (sets plus reps or seconds). It's the one-tap dose when no plan prescribes the movement, never a recommendation.

**Production UI (#79):** the expanded workout sheet includes a proportionate front/rear artwork preview and **Muscle coverage & log exercise**. The expanded inline workout and app menu also open coverage. The coverage sheet has fixed Close and scrollable art/detail/list content. It uses `loadExerciseHistory` and `exerciseState` for current coverage and suggestions, not a parallel engine. Historical workout logging uses its selected date; the coverage label always names today's date. Future-day forms are read-only.

- All 14 inventory groups have accessible, named text rows with effective sets and explicit unknown/priority/coverage/recovering/sore/injured labels. Automatic recovery is never labelled as injury. Selecting a row brings the corresponding detail into view.
- Supplied #77 PNGs and curved SVG region data are copied unchanged under `assets/hero-forge/app/`. PNG and path coordinates share the same 1024 × 1536 pixel system and scale proportionally. Profile `male`/`female` select their exact sets; absent/other/future values use the distinct neutral set. No new account or question.
- Priority uses warm outlines. Activation-only views in exercise details use filled primary and dashed secondary regions, never completion state. Sore reports use diagonal hatching; injury uses cross-hatching. Labels are always available; tiny SVG regions are optional shortcuts, never the sole control. Deep hip flexors remain a schematic surface projection. Costume orange is not status.
- **Report sore**, **Report injured**, **Clear report** call the existing store actions, refresh shared data and preserve cleared reports in history. Suggestions remain advisory and disclose held/caution reasons; all eligible choices stay available. Reports are global/current, not retrospective symptoms inferred from a past session.
- The eligible exercise picker uses configured equipment and avoid/caution rules. It shows engine-ranked strength choices and separately labelled time-based conditioning. Dose fields are editable drafts: a prescribed dose when available, otherwise one set/rep or a 60-second conditioning draft requiring confirmation. Plank has an inventory-owned one-set/20-second draft. Strength logs can explicitly use repetitions or seconds; conditioning is always seconds per round. Nothing is logged by viewing activation or a guide.
- Extra exercise logging has one stable submission ID over retries and a synchronous in-flight guard. Store upserts keep it idempotent. It never writes scheduled ticks, and session ticks never write extra logs. Recorded extra exercises can be removed. Scheduled exercises should use their checklist instead of an extra log.
- Display completed checklist rows after unfinished ones, preserving the day's frozen priority order within each partition and the original per-variant keys. Unticking restores the original position. Full/Short tick semantics stay unchanged.
