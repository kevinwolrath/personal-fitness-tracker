# First-pass proposal (issue #1)

Scope: contracts and design review only. **No production screens are implemented.** The contracts are in [`design-contracts/`](design-contracts/README.md). This document covers how I read the brief, the proposed screens and wireframes, the gesture choices, recommended scaffold changes and open questions.

All wireframes below are rendered from the **generic example fixture** ([`fixtures/plans/generic-example.plan.json`](../fixtures/plans/generic-example.plan.json)). The annotations (`← …`) show which plan field each piece of text comes from. Nothing in them is hard-coded.

---

## 1. Understanding of the brief

- It's a phone app for **following a plan day by day**. Most sessions are "open → tick something → close" and take under 10 seconds. Everything else is secondary.
- **The plan is content and the app is a renderer.** The current personal weight-loss plan becomes one JSON package. A different plan (another person, a new phase) is a different file, with no code changes.
- The bias is towards less: three tabs, one sheet deep, and one primary action per surface. Tracking means recording what happened against the plan, not food logging or analytics.
- Android and iOS are the product. Web is a phone-shaped harness for speed and Playwright.

## 2. Minimum information architecture

```
             ┌──────────── Bottom tabs ─────────────┐
             │                                      │
        ┌────┴────┐        ┌──────────┐       ┌─────┴────┐
        │  Today  │        │ Progress │       │   Plan   │
        └────┬────┘        └────┬─────┘       └────┬─────┘
             │                  │                  │
   ┌─────────┼─────────┐        │         ┌────────┼─────────┐
   ▼         ▼         ▼        ▼         ▼        ▼         ▼
 Measure  Activity   Day-type  Past day  Import   Export   (week
 sheet    sheet      menu      (push)    plan     data      overview
                                                            inline)
```

| Screen | Why it must exist | What's deliberately **not** on it |
|---|---|---|
| **Today** | The whole happy path | Charts, history, settings |
| **Measure sheet** | Fast numeric entry with a native keypad | Sliders, wheels, notes fields |
| **Activity sheet** | A home for the secondary actions (skip, undo) so rows stay clean | Timers, exercise libraries |
| **Progress** | "Is it working?" Goal delta, weight trend and recent days | Dashboards, tiles of stats, streaks |
| **Plan** | See the week at a glance, swap the plan file, export data | An editor. Plans are authored as JSON in V1. |
| **First run** | Load a plan | Onboarding carousel, profile set-up |

Settings: none in V1. Units, targets and schedule are all plan data.

## 3. Wireframes, primary happy path

### 3.1 Today: Monday 2 Nov (`schedule.mon` = `home`)

```
┌──────────────────────────────────────┐
│ ‹   Mon 2 Nov   ›        Home day ▾  │ ← dayTypes[schedule.mon].label
│                                      │
│ Today                                │
│ 2 of 7 done                          │ ← required activities resolved for today
│                                      │
│ ┌────────────────┐ ┌────────────────┐│
│ │ WEIGHT         │ │ GOAL           ││ ← measurements[weight] (due: every day)
│ │ 74.2 kg     +  │ │ 70 kg   −4.2   ││ ← goals[goal-weight], last value − target
│ └────────────────┘ └────────────────┘│
│ Energy ≤ 8,000 kJ · Protein 120–140 g│ ← nutrition.targets[]
│ Eating 08:00–19:30                   │ ← nutrition.eatingWindow
│                                      │
│ ─ Schedule ───────────────────────── │
│ ✓ 07:00  Morning walk       20–30 min│ ← activities[] timed, sorted by time
│ ✓ 08:00  Breakfast                   │    kind=meal → meal icon
│          Oats, yoghurt, berries      │ ← detail
│ ○ 12:30  Lunch                       │
│          Packed salad bowl…          │
│ ○ 15:30  Afternoon snack             │
│ ○ 18:30  Dinner           ≈ 2,900 kJ │ ← flexible: 8000 − (1900+2300+900)
│          Flexible · 10 g protein left│    120 − (35+45+30)
│                                      │
│ ─ Anytime ────────────────────────── │
│ ○ Strength session          30–45 min│ ← appliesTo.days includes mon
│ ○ Lunch walk      Optional  15–30 min│ ← required:false
│ ○ Stretch          ● ● ○  2/3 rounds │ ← tracking.count target 3
│                                      │
│ ┌──────────────────────────────────┐ │
│ │           I'm hungry             │ │ ← quickLogs[hunger]
│ └──────────────────────────────────┘ │
│   Logged 10:42, 14:05                │
├──────────────────────────────────────┤
│   ◉ Today      ○ Progress   ○ Plan   │
└──────────────────────────────────────┘
```

Notes:

- "2 of 7 done" counts required activities only (8 resolved, minus the optional Lunch walk). Done activities stay in place with a muted style, so the list doesn't jump around.
- The waist measurement isn't shown on Monday because its cadence is `week on sun`.
- The weight tile shows yesterday's value until today is logged. The `+` opens the measure sheet.

### 3.2 Same app, Thursday 5 Nov (`schedule.thu` = `office`). Only the data changes.

```
┌──────────────────────────────────────┐
│ ‹   Thu 5 Nov   ›      Office day ▾  │
│ Today                                │
│ 0 of 6 done                          │
│ …same tiles & targets…               │
│ ─ Schedule ───────────────────────── │
│ ○ 08:00  Breakfast                   │
│ ○ 08:15  Walk from station    15 min │ ← appliesTo.dayTypes [office]
│ ○ 12:30  Lunch                       │
│ ○ 15:30  Afternoon snack             │
│ ○ 18:30  Dinner           ≈ 2,900 kJ │
│ ─ Anytime ────────────────────────── │
│ ○ Lunch walk      Optional  15–30 min│
│ ○ Stretch          ○ ○ ○  0/3 rounds │
└──────────────────────────────────────┘
  (no Morning walk: home/weekend only · no Strength: mon/wed/sat only)
```

If I'm working from home on a Thursday, I tap **Office day ▾**, choose **Home day** and the list re-resolves. The choice is stored as a `day_override` for that date only.

### 3.3 Measure sheet (tap the Weight tile)

```
┌──────────────────────────────────────┐
│               ───                    │ ← drag handle (native sheet)
│ Cancel        Weight          Save   │ ← measurements[weight].label
│                                      │
│              74.2 kg                 │ ← prefilled last value, unit from units.mass
│           yesterday 74.4             │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │      native decimal keypad       │ │ ← keyboardType="decimal-pad"
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

### 3.4 Activity sheet (tap the row's chevron area, or long-press)

```
┌──────────────────────────────────────┐
│               ───                    │
│ Lunch walk                    Close  │ ← label
│ Optional · 15–30 min                 │ ← required / duration
│                                      │
│ ┌──────────────────────────────────┐ │
│ │            Mark done             │ │ ← the single primary action
│ └──────────────────────────────────┘ │
│              Skip today              │ ← secondary (also: swipe row left)
└──────────────────────────────────────┘
```

Tapping the row body toggles done (or advances the count). The sheet is reached through a small trailing `›` target on the row, or by long-pressing it. It's never needed for the happy path.

### 3.5 Progress

```
┌──────────────────────────────────────┐
│ Progress                             │
│                                      │
│ 74.2 kg  →  70 kg                    │ ← latest weight → goals[].target
│ 4.2 kg to go · −1.8 kg in 4 weeks    │
│                                      │
│  ╲_                                  │ ← simple line, weight, last 8 weeks
│     ╲__╱╲_                           │
│           ╲___  ·  ·  ·  ·  70       │ ← goal line
│                                      │
│ Waist  88 cm  (Sun)                  │ ← weekly measurement, latest
│                                      │
│ ─ Recent days ────────────────────── │
│ Sun 1 Nov    6/6  ●                  │ ← day completion (contract 03 §7)
│ Sat 31 Oct   4/5                     │
│ Fri 30 Oct   5/5  ●   hungry ×2      │ ← quick-log count
│ …                                    │ → tap = past-day view (read-only > 1 day old)
└──────────────────────────────────────┘
```

### 3.6 Plan

```
┌──────────────────────────────────────┐
│ Everyday strength & walking          │ ← title
│ Revision 1                           │ ← revision
│                                      │
│ Mon  Home day     · Strength         │ ← schedule + notable activities
│ Tue  Office day                      │
│ Wed  Home day     · Strength         │
│ Thu  Office day                      │
│ Fri  Home day                        │
│ Sat  Weekend      · Strength         │
│ Sun  Weekend      · Waist            │
│                                      │
│ Import plan file…                    │
│ Export my data                       │
└──────────────────────────────────────┘
```

### 3.7 First run (no plan loaded)

```
┌──────────────────────────────────────┐
│                                      │
│      Load a plan to get started      │
│                                      │
│ ┌──────────────────────────────────┐ │
│ │        Import plan file          │ │
│ └──────────────────────────────────┘ │
│           Use example plan           │
└──────────────────────────────────────┘
```

## 4. Tap vs swipe/drag

The full table is in [contract 02](design-contracts/02-navigation-interactions.md#interaction-rules). In summary:

- **Tap** handles everything on the happy path: complete, count, log weight, quick-log, change day, change day type.
- **Swipe left on a row → Skip or Restore.** This is the only custom gesture. It's justified because skipping optional items is frequent, the swipe keeps a Skip button out of every row, and it's a standard native list pattern. Skip is also available from the activity sheet and as an accessibility action.
- **Drag down to dismiss sheets.** This is native behaviour and costs nothing.
- **Rejected:** horizontal day paging (conflicts with row swipe and the iOS back gesture), drag-to-reorder (order is plan data), sliders or wheels for weight (typing is faster and more precise), pull-to-refresh (nothing remote).

## 5. Recommended scaffold changes

| # | Current | Change | Why |
|---|---|---|---|
| 1 | `app/index.tsx` hard-codes the week plan, weight 98 kg, goal 78 kg, kJ and protein targets, meals and the hunger button | Replace with a plan-driven Today screen during implementation. Move the personal content into a plan package (see §7.3). | Violates the core rule. |
| 2 | `README.md` "V1 goals" lists personal-plan specifics (school run, VR boxing, family dinner) | Rewrite as generic product goals and link to `docs/design-contracts`. | The README describes the product, not one plan. |
| 3 | No web dependencies | `npx expo install react-dom react-native-web @expo/metro-runtime`. Add `"web": {"bundler": "metro", "output": "single"}` to `app.json`. | `npm run web` can't work without them. |
| 4 | Single `app/index.tsx` route | `app/(tabs)/_layout.tsx` with `index`, `progress` and `plan`, plus `app/measure/[id].tsx` and `app/activity/[id].tsx` with `presentation: 'formSheet'`. | Matches contract 02. |
| 5 | Everything in one file, styles inline | Keep routes thin under `app/`. Put domain code in `src/`: `src/plan/` (types, validate, resolveDay), `src/storage/` (repository), `src/ui/` (tokens and primitives). | Pure plan resolution becomes unit-testable without React. |
| 6 | No runtime validation | Add `zod` (v4) as the in-code schema. Generate `plan.schema.json` from it with `z.toJSONSchema` and check the output in CI against the committed file. | One source of truth after approval. Until then the committed JSON Schema is authoritative. |
| 7 | No gesture libraries | `npx expo install react-native-gesture-handler react-native-reanimated react-native-worklets` (for `ReanimatedSwipeable`). Add `expo-haptics`, `expo-document-picker` and `expo-sharing` when their features land. | Needed for the swipe row, the native feel, import and export. |
| 8 | No tests | `jest-expo` for `src/plan` unit tests. `@playwright/test` driving `expo start --web` for contract 05. | Test surface required by the brief. |
| 9 | `userInterfaceStyle: "automatic"` but colours are hard-coded light | Set `"light"` for V1 (or commit to dark tokens; see §7.4). | Avoid light content under dark system chrome. |
| 10 | Dates use `new Date().getDay()` and locale `en-AU` | Use a local-date helper (`YYYY-MM-DD`) and the device locale for formatting. | Day keys must be local calendar dates (contract 04). |
| 11 | No lockfile; versions hand-pinned | Run `npx expo install --fix` and commit `package-lock.json`. | Keeps native module versions aligned with SDK 54. |
| 12 | `expo-sqlite` plugin present | Keep it, behind the repository interface (contract 04). | — |

## 6. Plan JSON in brief

See [contract 03](design-contracts/03-plan-format.md). The shape of the format:

```jsonc
{
  "format": "pft-plan", "formatVersion": 1,
  "id": "generic-example", "revision": 1, "title": "…",
  "units": { "mass": "kg", "energy": "kJ", "length": "cm" },
  "dayTypes": [{ "id": "home", "label": "Home day" }, …],
  "schedule": { "mon": "home", …, "sun": "weekend" },
  "measurements": [{ "id": "weight", "quantity": "mass", "cadence": { "every": "day" } }, …],
  "goals": [{ "measurementId": "weight", "target": 70, "direction": "decrease" }],
  "nutrition": { "targets": [{ "id": "energy", "max": 8000 }, …], "eatingWindow": { … } },
  "activities": [{ "id": "strength", "kind": "exercise", "duration": { "min": 30, "max": 45 },
                   "appliesTo": { "days": ["mon","wed","sat"] }, "required": true,
                   "tracking": { "type": "check" } }, …],
  "quickLogs": [{ "id": "hunger", "label": "I'm hungry" }]
}
```

I checked that the current personal plan fits this format without schema changes:

- Home and office days are `dayTypes`.
- The school run, lunch walk and drive are timed activities scoped by day type.
- The optional dog walk uses `required: false`.
- VR boxing 3 × 3 min is `count` with target 3, unit "rounds".
- The fixed lunch and snack are meals with nutrition.
- Family dinner is `flexible: true`.
- Energy and protein are nutrition targets, and the ~12–8 pm window is `eatingWindow`.
- Weight daily and waist weekly are measurements, with weight against the goal.
- "I'm hungry" is a quick log.

The two driving activities aren't exercise. I'd model them as `habit` or leave them out. They're context, not something to tick off.

## 7. Open questions and genuine blockers

1. **`expo-sqlite` on web (blocker-ish).** Web support in `expo-sqlite` uses WASM. It needs `SharedArrayBuffer`, which means serving COOP/COEP headers from the dev server, plus Metro config for `.wasm`. Options:
   - (a) configure that, so web and native run the same SQL. This is my preference if it proves stable in a short spike.
   - (b) use an in-memory or `localStorage` backend on web behind the same repository interface. This is simpler, but Playwright then doesn't exercise real SQL.

   I propose a 1-hour spike of (a) at the start of implementation, falling back to (b).
2. **Nutrition scope.** I've assumed V1 shows targets and a planned-intake budget derived from ticked-off fixed meals, and doesn't **log food**. Is that right, or do you want a single "dinner kJ estimate" entry on the flexible meal? (It would be a small addition: one number per day.)
3. **Where the personal plan lives.** The personal plan contains health data. Should it be a committed fixture (`fixtures/plans/personal.plan.json`), or git-ignored and imported on device only? The repo's visibility matters here. My default is git-ignored, with the generic fixture committed.
4. **Dark mode.** Light only for V1 (my default), or both from the start? Tokens make either cheap, but both doubles visual baselines.
5. **Reminders.** The README mentions "lunch/snack reminders". I've put notifications out of scope for V1 (contract 01). Tell me if that's wrong. It would add `expo-notifications` and a `reminder` field on activities.
6. **Editable window.** Today plus yesterday is editable and older days are read-only. Is that OK?

No conflicts found between the brief's requirements otherwise.

---

**Stopping here for review.** No production screens have been implemented. Once you've agreed or adjusted the contracts and the answers above, implementation starts with `src/plan` (types, validation, `resolveDay`, with unit tests against the fixture), then Today.
