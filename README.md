# Personal Fitness Tracker

A deliberately simple, local-first fitness diary for Android and iOS, built with Expo, React Native and TypeScript. The app renders a **plan package**, a versioned JSON file, rather than hard-coding a plan, and keeps one continuous **Daily Log** of what actually happened.

**Architecture:** the Daily Log is the primary application surface. Today is the current date within that log. Every date uses the same underlying day view, canonical data model and editing behaviour. New capabilities extend the shared model and continuous history rather than creating isolated feature slices.

Design contracts (authoritative): [`docs/design-contracts/`](docs/design-contracts/README.md).

## How it fits together

```
manual entry / Health Connect ──▶ canonical observations + activity records ──▶ TrackingStore ──┬─▶ Daily Log (any date)
                                                                              SQLite (native)   └─▶ JSON export (full history)
                                                                              localStorage (web)
plans/seed.plan.json ──▶ validatePlan ──▶ active plan ──▶ resolveDay(plan, date, override) ──▶ Daily Log
```

| Path | What |
|---|---|
| `plans/seed.plan.json` | Bundled seed plan, installed on first run. Edit it, bump `revision`, and ship. |
| `fixtures/plans/` | Generic plans for tests. |
| `src/plan/` | Schema (zod mirror of `plan.schema.json`), validation, date helpers, `resolveDay`. Pure and unit-tested. |
| `src/storage/` | `TrackingStore` interface: `sqliteStore` (native), `keyValueStore` (web), `openStore[.web].ts` selects one. |
| `src/features/shell/` | App shell (contract 02 "Layout layers"): the persistent app bar and the app menu (import, configure, export). |
| `src/features/daily-log/` | The Daily Log day view (`DayLogScreen`) used for every date, its sheets, and pure helpers (`dayLabels`, `dayContent`). |
| `src/observations/` | Canonical observation model and metric catalog, unit conversion, Health Connect mapping. |
| `src/exercises/` | Exercise library (contract 09): reusable definitions, bundled illustrations, `buildGuide`. Pure, no UI. |
| `src/prescription/` | Daily prescription engine (contract 08): `prescribeDay`, `nextAction`, completion log entries, session substitutions, time windows. Pure, no UI. |
| `src/config/` | AI configuration: sections over the plan, update parser/applier, preview diff, AI instructions, history/undo (contract 07). |
| `src/features/configure/` | Configure-with-AI screen. |
| `src/export/` | Full-history JSON export (`pft-export` v1) and its inverse for restore. |
| `src/platform/` | Native/web adapters for secure storage and files/sharing. |
| `src/ui/` | Theme tokens, shared UI (`Toast`) and platform adapters (`Sheet`, `ConfirmDialog`, `PhoneFrame`, `haptics`). |
| `app/` | Expo Router routes. Kept thin. Main screens sit in the `(main)` group, whose layout renders the app shell. |

## Run

```bash
npm install
```

```bash
npm start
```

Press `a` for Android, `i` for iOS, or `w` for web. Web renders inside a phone-width frame.

## Check

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run check:native
```

```bash
npm run test:e2e:dev
```

- `npm test` runs unit tests, plus the Daily Log rendered under the iOS and Android presets.
- `npm run test:e2e` runs Playwright on the web export at 360, 390 and 430 px, plus a responsive sweep from 320 to 1280 px. Run `npx playwright test --update-snapshots` after an intended visual change.
- `npm run check:native` bundles iOS and Android and compiles Hermes bytecode.
- `npm run test:e2e:dev` boots the Metro dev server (what `npm start` runs) and checks it loads without errors and a measurement can be logged.

## Build an Android APK (on your PC)

Needs Docker Desktop. From the repo root in PowerShell:

```bash
./scripts/build-apk.ps1
```

This builds a **release** APK inside Docker (`docker/android.Dockerfile`) and writes `artifacts/personal-fitness-tracker.apk`, ready to sideload. The JS bundle is embedded, so the app starts on its own: no Metro, USB, `adb reverse` or dev server. Both the image and the script fail the build if `assets/index.android.bundle` isn't inside the APK. The APK is for 64-bit ARM phones (`arm64-v8a`, almost every phone from the last decade), which keeps the build short; add `-AllAbis` for an emulator or an old 32-bit phone. npm and Gradle downloads are cached between builds (Docker BuildKit cache), so later builds are much faster than the first. Add `-NoCache` to rebuild every step. It runs only on your machine; there's no CI build.

It's signed with Expo's debug keystore, which is fine for sideloading but not for the Play Store. A debug APK (`assembleDebug`) is never used here: React Native leaves the JS out of debug builds and loads it from Metro, which is what causes "Unable to load script".

## Screenshot import (removed)

The screenshot import was removed in #138; Health Connect and Body Anvil sync replace it. Values imported from screenshots before then are kept, shown, exported and backed up as before.

## Today: do this next

The Daily Log opens on **Do this next**, the next thing your plan prescribes for now. Tick it off and the app moves to the next one. The rest of the day is grouped by morning, midday, afternoon, evening and anytime. Alternatives that meet the same need (for example VR boxing, heavy bag or battle ropes for tonight's conditioning) count once, whichever you do. Strength sessions list their exercises, with your limitations' substitutes applied, and have a short version for busy days. See [contract 08](docs/design-contracts/08-daily-prescription.md).

When a strength workout is next, the card stays compact: the workout, your progress and the **next exercise**. Tick it when it's done and the next one appears. Expand the card for the whole list, or to choose the **Full** or **Short** version. Ticking the last exercise completes the workout, which still counts as one task for the day. Ticks survive restarts and can be corrected later from the workout's details.

Tap a meal (anywhere but its circle) to see exactly what to prepare: each ingredient with its target amount and an everyday measure such as "~¾ cup", how to make it, and its energy and protein. When a meal is next, the same list is right on the **Do this next** card. Everything comes from the plan, so any meal can be described without an app change. The circle ticks the meal off.

Tap any exercise for an illustrated guide: step-by-step pictures, the equipment you have for it, and how to do it, with today's sets and reps. Closing it leaves the day exactly as it was. See [contract 09](docs/design-contracts/09-exercise-guides.md).

## Configure with AI

Daily Log → ☰ → **Configure with AI**. Copy the instructions into ChatGPT or Claude, talk through what you want to change (diet, equipment, injuries, schedule, goals), and paste back the update it gives you. The app validates it, shows exactly what will change, and applies it only when you tap **Apply update**. Sections the update doesn't mention are left exactly as they were, and the last change can be undone. See [contract 07](docs/design-contracts/07-ai-configuration.md).

## Changing the plan

Day to day, use **Configure with AI** (above). If you've already changed your configuration in the app, the new default lunch won't replace it: paste `fixtures/config/lunch.update.json` into **Configure with AI**. It changes only the lunch (a merge by id), adding its ingredients, preparation and nutrition. Your other meals and everything else stay exactly as they are. To change the bundled default for fresh installs, edit `plans/seed.plan.json`, keeping it valid against `docs/design-contracts/plan.schema.json`. `npm test` checks this. Then bump `revision`. Installed apps pick up a higher revision of the same plan `id` on next launch, unless the user has already changed their configuration in the app, which is never overwritten. Tracking history is always kept.
