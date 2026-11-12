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

- Production guides select the profile's established Body Anvil hero: male/female explicitly, neutral for absent/other/unknown values, using the same rule as muscle maps. Every library step has all three character variants (189 poses across 31 exercises). The manifest maps stable library `baseImage` IDs plus `hero` to the matching asset; profile changes resolve again on render. Existing poses are retained, with 64 missing poses generated using the approved character references at the owner's request. See `docs/design/profile-exercise-heroes/README.md` for provenance, contact sheets and screenshots.
- Offline JPEG steps live under `assets/exercises/heroes/`. `manifest.json` records stable IDs, movements, character assignments and step order. `src/exercises/heroIllustrations.ts` uses literal static `require` calls so Metro ships each image on web, iOS and Android. No remote URL, API key or image-generation service is required at runtime.
- All starter-preset movements are now in the shared inventory with all three hero guides (#158). `src/exercises/illustrationExceptions.json` is empty; tests reject new untracked gaps and stale exceptions. Equipment access follows contract 18.
- User-created movements are the explicit illustration exception until promoted into the bundled catalogue; never show an unrelated pose. The guide for the custom `kettlebell_shrug` movement is now bundled with straight-up/down shoulder motion and all three heroes (#153; `docs/design/issue-153/`). Catalogue coverage tests must start from the inventory, not only existing library definitions.
- Every tracked inventory movement has illustrated steps and instructions; the supinated cross-body dumbbell curl has three phases (start and both alternating sides), while existing movements retain two steps; the existing cable-row guide is retained too. Doses stay owned by workouts/configuration, never the artwork. Conditioning illustrations do not turn time-based activity into strength logging.
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
- **Conditioning** stays separate from strength sessions and suggestions, but its muscle work counts. Movements outside the current shared inventory keep their data and simply add no muscle history; promoted catalogue movements use their shared mappings.

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

**Acceptance follow-through (#56):** while coverage stays open, minute/foreground clock changes refresh the existing engine's recovery state without resetting the selected muscle, Priority/Reports view or logging draft. All logger drafts resolve against the plan's complete shared catalogue, including custom default sets and seconds/repetitions; viewing or refreshing never records work. Today's prescribed counts remain separate from catalogue extras (contract 08). The current approved Hero Forge maps/outlines and textual status cues below supersede historical silhouette/four-colour mock-up wording.

- All 14 inventory groups have accessible, named text rows with effective sets and explicit unknown/priority/coverage/recovering/sore/injured labels. Automatic recovery is never labelled as injury. Selecting a row brings the corresponding detail into view.
- Supplied #77 PNGs and curved SVG region data are copied unchanged under `assets/hero-forge/app/`. PNG and path coordinates share the same 1024 × 1536 pixel system and scale proportionally. Profile `male`/`female` select their exact sets; absent/other/future values use the distinct neutral set. No new account or question.
- Priority uses warm outlines (muscles below this week's target: approaching target and priority for training). The coverage sheet has two views: **Priority** (outlines plus any reports) and **Reports** (sore and injured only, with a plain message when nothing is reported). Each view's legend names only the marks it can show, and each tab's spoken name starts with its visible label. Activation-only views in exercise details use filled primary and dashed secondary regions, never completion state. Sore reports use diagonal hatching; injury uses cross-hatching. Labels are always available; tiny SVG regions are optional shortcuts, never the sole control. Deep hip flexors remain a schematic surface projection. Costume orange is not status.
- **Report sore**, **Report injured**, **Clear report** call the existing store actions, refresh shared data and preserve cleared reports in history. Suggestions remain advisory and disclose held/caution reasons; all eligible choices stay available. Reports are global/current, not retrospective symptoms inferred from a past session.
- The eligible exercise picker uses configured equipment and avoid/caution rules. It shows engine-ranked strength choices and separately labelled time-based conditioning. Dose fields are editable drafts: a prescribed dose when available, otherwise one set/rep or a 60-second conditioning draft requiring confirmation. Plank has an inventory-owned one-set/20-second draft. Strength logs can explicitly use repetitions or seconds; conditioning is always seconds per round. Nothing is logged by viewing activation or a guide.
- Extra exercise logging has one stable submission ID over retries and a synchronous in-flight guard. Store upserts keep it idempotent. It never writes scheduled ticks, and session ticks never write extra logs. Recorded extra exercises can be removed. Scheduled exercises should use their checklist instead of an extra log.
- Display completed checklist rows after unfinished ones, preserving the day's frozen priority order within each partition and the original per-variant keys. Unticking restores the original position. Full/Short tick semantics stay unchanged.

## Muscle Growth (#122)

A separate, configurable training category for chosen target muscles (for example biceps and upper back). It's a short optional routine, such as a lunch-break session, that sits beside the resistance session. It's **not** a second exercise system: it uses the same catalogue, ids, muscle mappings, guides, checklist row, exercise logs and muscle accounting as everything above.

**Shared catalogue** (`src/exercises/catalogue.ts`, pure):
- `inventoryFor(plan)` is the bundled inventory plus `plan.exercise.customExercises` (formatVersion 8). Custom exercises have the same shape as inventory entries (`movement`, `name`, `kind`, `equipment`, `primary`, `secondary`, `defaultDose`), plus optional `guidance` cues that the guide shows. They have no illustrations ("No illustration for this exercise yet").
- Anything that plans, logs or counts exercises for a plan uses `inventoryFor(plan)`: Today's workout, the coverage sheet, logging, coverage and the share text. Custom exercises are therefore eligible extras and loggable everywhere, with the same equipment and avoid/caution rules.
- On apply, `catalogueErrors` rejects:
  - a custom exercise that repeats a built-in id or name (no duplicates);
  - unknown muscle groups;
  - routine movements that aren't in the catalogue, are marked `avoid`, or don't work a target.
- **Upper traps are Upper back** (owner decision on #126). There's no separate traps group or body-map region, and no logs are remapped. "traps" in an update is rejected with a pointer to `upper_back`, and the editor says "Upper traps count as Upper back". There are no built-in shrug illustrations: users add their own trap exercise, such as "Dumbbell shrug" with `primary: ["upper_back"]`, as a custom exercise.

**Configuration** (`plan.exercise.muscleGrowth`, contract 07):
- Fields: `enabled`, `targets` (1–6 muscle groups), `exercises` (`movement`, optional `sets`, `reps` or `seconds`, `loadKg`), optional `days` (absent means every day) and `when` (display only).
- It's set up in **Muscle Growth** (app menu, or **Edit** on the section) or through Configure with AI. The editor has a **Days** selector. All seven days are saved as no `days` (every day), and existing days are kept unless the user changes them. At least one day is required. Both write the same validated configuration change, with history and Undo.
- The editor offers only eligible strength exercises whose primary muscles include a target, then those that work one secondarily. It never lists the whole catalogue, and "avoid" movements never appear.
- Changing targets drops exercises that no longer fit from the routine. Earlier days' logs are never touched.
- It never changes the schedule, rest days, the resistance session or loads.

**Today:**
- `muscleGrowthDay(plan, date, logs)` lists the routine's exercises that are eligible and work a target, each with its planned dose.
- On a date, anything logged for Muscle Growth that's no longer in the routine still shows there. History is what was logged.
- The section uses `ExerciseChecklist`. The circle completes. **Skip** is an explicit skip (pending and skipped stay distinct), and a skipped row offers **Undo**. Ticking a skipped row completes it.
- Each item is one `exercise_log` per date and movement (`routine: muscle_growth`, `status` done or skipped, contract 04). Complete, Skip and a details edit replace that record, so a correction never duplicates it. Undo removes it.
- **Details** on a done row records what was actually done: sets, reps or seconds, load in kg, and reps in reserve. RIR maps to intensity for effective sets: 0–1 hard, 2–3 moderate, 4+ light.
- Muscle Growth completion is separate from Today's workout. Its logs are never Today's workout extras, and they never change that card's counts.

**Shared accounting:**
- Completed items are history entries like any free log. Weekly effective sets, recovery windows, suggestions and the coverage sheet count Muscle Growth and Resistance Training together. For example, evening hammer curls and pulldowns add to a lunchtime biceps routine's load, and recovery follows the load, not a fixed number of hours.
- The section shows each target's weekly effective sets and status from the same coverage ("This week, all training: Biceps 5 sets (recovering)").
- Skipped items add no muscle load, XP, progress or performance achievements.

**Progression** (`progressionHint`): advice only, never an automatic change. A movement gets a suggestion only after its last two completed sessions both reached the planned sets and reps with at least 2 reps in reserve.

## My Gym integration (#158)

Equipment/station access and complete alternatives use contract 18. Previously custom shrug and preset IDs promoted into the inventory preserve existing custom metadata and prescriptions through explicit allowCustomOverride entries; they never become duplicate tracking rows. Guides use relevant selected equipment, not every machine of the same broad type. Unavailable scheduled guides remain readable as references with an explicit My Gym review note.
