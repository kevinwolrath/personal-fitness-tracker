# 03 · Plan package format (`pft-plan`, formatVersion 1–4)

A **plan package** is a single JSON file describing a fitness plan. The app renders whatever valid plan is loaded and has no built-in plan of its own. The machine-readable contract is [`plan.schema.json`](plan.schema.json) (JSON Schema 2020-12). This document defines semantics and the rules the schema cannot express.

Example: [`fixtures/plans/generic-example.plan.json`](../../fixtures/plans/generic-example.plan.json).

**formatVersion 2** adds the optional `profile` and `exercise` sections (contract 07) and the daily-prescription fields: activity `purpose`, `when`, `after`, `session` and `satisfies`, and plan-level `requirements` (contract 08). A formatVersion 1 plan must not contain them.

**formatVersion 3** (#26) adds what a meal is made of: activity `ingredients` and `preparation`, for meals only. A formatVersion 1 or 2 plan must not contain them. Older versions still load unchanged.

**formatVersion 4** (#30) adds activity `notifications`: plan-defined local reminders (contract 10). A formatVersion 1–3 plan must not contain them. Configure with AI writes formatVersion 4. Everything else below applies to every version.

## Design limits (deliberate)

- **Describes, doesn't compute.** There are no expressions, conditions, scripts, plugins or custom fields. The only selectors are "which days does this apply to" (`appliesTo`) and the user's day-type override.
- **Strict.** Unknown properties are rejected (`additionalProperties: false`). Plans are hand-authored, so strictness catches typos.
- **Small.** Collection sizes are capped in the schema (for example 60 activities, 8 measurements, 4 goals) so that Today stays a calm, single scroll.

## Versioning

| Field | Meaning |
|---|---|
| `format` | Always `"pft-plan"`. |
| `formatVersion` | Integer version of **this contract**. The app supports exactly the versions it lists. It rejects a higher version with "This plan needs a newer app" and migrates lower versions in code. A breaking schema change bumps this number. Additive optional fields may also bump it, because v1 is strict. |
| `id` | Stable slug for the plan. User data is keyed by it (see 04). |
| `revision` | Integer the plan **author** bumps on every content change. Importing the same `id` with a higher `revision` updates the plan and keeps history. A lower or equal revision asks before replacing. |

## Top-level fields

| Field | Req | Notes |
|---|---|---|
| `title`, `description` | title | Shown on the Plan tab. |
| `units` | ✓ | Display units for `mass` (kg/lb), `energy` (kJ/kcal) and `length` (cm/in). All values in the plan are expressed in these units. The app doesn't convert in V1. |
| `dayTypes` | ✓ | 1–7 named variants of a day, for example `home`, `office`, `weekend`. |
| `schedule` | ✓ | Default day type for each weekday, `mon` to `sun`, all required. |
| `measurements` | | Values the user records. `quantity` is `mass`, `length` or `number` (with `unitLabel`). `cadence` is `{every:"day"}` or `{every:"week", on:"sun"}`. |
| `goals` | | Target value for a measurement plus a `direction` (decrease, increase or maintain). |
| `nutrition.targets` | | Daily targets with `min` and/or `max`. `quantity` is `energy` (plan energy unit) or `grams`. Optional `appliesTo`. |
| `nutrition.eatingWindow` | | `start`/`end` `HH:MM`. Display only. |
| `activities` | ✓ | Everything that appears in the day list, including meals (see below). |
| `quickLogs` | | At most 2 one-tap event loggers. Each tap records a timestamp. Kept in the format, storage and export. The Daily Log has had no quick-log buttons since #15, and the seed plan (revision 3) defines none. |

## Activities

One list covers exercise, meals and habits, so that a single timeline renders the day.

| Field | Default | Meaning |
|---|---|---|
| `id` | | Unique within the plan. Used to key completion records, so keep it stable across revisions. |
| `kind` | | `exercise`, `meal` or `habit`. This affects icon and grouping only. |
| `label`, `detail` | | Row title (40 characters or fewer) and one-line subtitle (120 characters or fewer). |
| `time` | untimed | `HH:MM` local time. A **timed** activity is ordered by time. An **untimed** one appears in an "Anytime" group after the timed ones, in plan order. |
| `duration` | none | `{minutes}` or `{min,max}`. Display only ("20–30 min"). The app doesn't run timers in V1. |
| `required` | `true` | `false` makes the activity **optional**: it's shown with an "Optional" label and doesn't count towards day completion. |
| `appliesTo` | every day | `{dayTypes:[…]}` **or** `{days:["mon",…]}`, not both. |
| `tracking` | `{type:"check"}` | `check` is a single done or not-done. `{type:"count", target: 2–12, unitLabel}` is done when count reaches target, for example 3 rounds. |
| `nutrition` | | **Meals only.** Map of `nutrition.targets[].id` to the amount this meal contributes. |
| `flexible` | `false` | **Meals only.** The amount isn't fixed. The row shows the remaining budget instead of values (see below). Must not also have `nutrition`. |
| `ingredients` | | **Meals only, formatVersion 3.** What to prepare: 1–20 items, each `{ name, grams?, ml?, measure? }`. Each item needs at least one of the three. `grams`/`ml` are the target amount. `measure` is the plan's everyday wording for people without scales ("~¾ cup", "1 scoop", "as needed"). The app shows it **exactly as written and never converts units**, because cup conversions aren't precise. |
| `notifications` | none | **formatVersion 4.** Up to 3 reminders, each `{ offsetMinutes \| at, title, body }`: `offsetMinutes` counts from the activity's `time` or its day part's start (negative = before; not allowed on "anytime" activities), `at` is `"HH:MM"`. Absent or `[]` means no reminder. Whether reminders are switched on is a device preference, never plan data (10). |
| `preparation` | | **Meals only, formatVersion 3.** How to make the meal, in the plan's words (≤ 400 characters), e.g. how much water to add. |

A meal's energy and protein come from its existing `nutrition` map, shown in the plan's units ("≈ 1,780 kJ · 42 g protein"). There are no separate calorie fields.

## Resolving a day (how the app renders data)

1. **Day type** is the user's override for that date if one exists, otherwise `schedule[weekday]`.
2. **Activities** are those whose `appliesTo` is absent or matches the date's day type or weekday. Timed ones are sorted by `time`, with untimed ones after them in plan order.
3. **Nutrition targets** are those whose `appliesTo` is absent or matches.
4. **Planned intake** is the sum of `nutrition` for the day's **non-flexible meals**. This is planned, not measured. V1 doesn't log food.
5. **Flexible-meal budget**: for each target, `min − planned` if the target has a `min` ("to go"), otherwise `max − planned` ("left"), clamped to 0 or more. It's shown on the flexible meal row, for example "≈ 2,900 kJ left · ≈ 10 g protein to go". It's shown only if the day has exactly one flexible meal, and a target's line appears only when **every fixed meal that day states a value for it**. A partly specified plan never shows a misleading number.
6. **Measurements due**: `every:"day"` is due every day, and `every:"week"` is due on its `on` weekday (with a quiet "last logged…" on other days).
7. **Day completion**: a day is complete when every **required, non-skipped** activity is done. Optional activities never count. A skipped required activity is removed from the total ("2 of 6" rather than "2 of 7"). Any activity may be skipped. This is the only completion rule.
8. **Count tracking**: a row tap adds one unit. Reaching `target` marks it done, and one more tap resets it to zero. Partial progress is stored with status `pending`.

## Validation rules (beyond the schema)

The loader must reject a plan, with a human-readable message, when:

- ids are duplicated within any collection;
- `schedule`, `appliesTo.dayTypes` or `goals[].measurementId` reference unknown ids;
- an activity that isn't a meal has `nutrition` or `flexible`, or a meal has both;
- a meal's `nutrition` key doesn't match a nutrition target id;
- any `min` is greater than its `max`;
- `unitLabel` is set on a measurement whose quantity isn't `number`.

Validation happens once, on import. Stored plans are trusted.

## Explicitly not in v1

Multi-week or periodised programs, progressive overload, sets, reps and weights per exercise, timers, reminders, per-day text overrides, conditional logic, localisation of plan text, unit conversion. Each would need a new `formatVersion`.
