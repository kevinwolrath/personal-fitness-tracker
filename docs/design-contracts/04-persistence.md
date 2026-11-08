# 04 · Persistence & data ownership

## Ownership

- **Meal photos (#97)** are user records too: permanent files in the app's private document directory, deleted only by the user (contract 15). They are never uploaded by the app.
- **All data belongs to the user and lives on the device.** V1 has no accounts, backend, analytics or telemetry. The only network call is user-initiated screenshot reading with the user's own API key (contract 06).
- There are two kinds of data, and they never mix:
  - **Plan package**: authored content. The app reads it and never edits it. It can be replaced by importing a new package.
  - **User records**: what happened. They're written only by user actions and never derived from or embedded in the plan.
- **Seed plan:** the app bundles one plan package, `plans/seed.plan.json` (currently the personal weight-loss plan, decided in issue #3). **It is never installed for a new user (#49):** a fresh install has no plan and goes through first-run setup (13), which creates the user's own plan (`origin: onboarding`). Installs that already run the seed keep it: a later build with the same `id` and a higher `revision` replaces it silently, keeping history. A plan with a different `id` (a future import) is never overwritten by the seed. UI code never reads the seed directly; it only sees the active plan.
- Tracking data is runtime-only and never committed. Only plan packages and generic fixtures live in source control.

## Storage

- **Native:** SQLite via `expo-sqlite`, accessed only through a small repository module, for example `src/storage/`. Screens never run SQL.
- **Web (test surface):** the same `TrackingStore` interface over `localStorage`: one JSON document under `pft:tracking:v1` (decided in issue #3, so no SQLite/WASM in the browser). It falls back to in-memory storage if `localStorage` is unavailable. Platform selection is by file extension (`openStore.ts` / `openStore.web.ts`).
- Both implementations must pass the shared suite in `src/storage/__tests__/store.contract.ts`. The SQLite implementation is tested against Node's built-in SQLite through the same `SqlDatabase` interface expo-sqlite provides.
- Schema migrations are numbered and run on startup. Never destructive without an export first. Migration 2 (#7) is additive: it adds `plan.origin` (existing plans become `seed`) and `config_change`. Migration 3 (#10) is additive too: it adds `activity_log.variant` and `requirement_id`, plus `completion_event` and `day_snapshot`. Migration 4 (#28) adds `activity_log.exercises_done` (a JSON array of exercise keys, contract 08). Migration 5 (#56) adds two new tables, `exercise_log` and `muscle_report`; nothing existing changes. Migration 6 (#97) adds one new table, `meal_log`; nothing existing changes. Tests open real version-1, version-3, version-4 and version-5 databases and check nothing is lost. The web document gains `exerciseLogs` and `muscleReports` lists; documents written before them read as empty. It gains `mealLogs` (#97) the same way.

## Records (logical model)

| Record | Key | Fields |
|---|---|---|
| `plan` | `planId` | `revision`, `formatVersion`, `json` (verbatim package), `importedAt`, `origin` (`seed`/`config`/`import`/`onboarding`). Exactly one active plan. |
| `config_change` | `id` | `appliedAt`, `sections`, `payload`, `fromRevision`, `toRevision`, `previousPlanJson` (contract 07) |
| `activity_log` | `planId, date, activityId` | `status` (`pending`, `done`, `skipped`), `count` (for count tracking; `pending` means partial), `labelSnapshot`, `updatedAt` (completion time), `variant` (`full`/`short`), `requirementId` (alternative used). `activityId` is `req:<id>` for a skipped requirement. |
| `completion_event` | `id` | Append-only: `planId`, `date`, `activityId`, `requirementId`, `action` (`complete`/`progress`/`undo`/`skip`/`restore`), `count`, `variant`, `label`, `purpose`, `at` (contract 08) |
| `day_snapshot` | `planId, date` | `planRevision`, `prescribed` (what was prescribed that day), `updatedAt` |
| `observation` | `id` | `date`, `metric`, `value` (canonical unit), `unit`, `kind` (`observed`/`inferred`), `label`, `note`, provenance (`source_*`), `recordedAt`. Not plan-scoped. See contract 06 |
| `import_session` | `id` | `createdAt`, `extractor`, `assets` (JSON) |
| `quick_log` | `id` (uuid) | `planId`, `quickLogId`, `at` (ISO timestamp with offset) |
| `day_override` | `planId, date` | `dayTypeId` |
| `exercise_log` | `id` | An exercise done **outside** a scheduled session (#56): `movement` (inventory id), `date`, `at`, `sets`, `reps`/`seconds` (or null), `intensity` (`light`/`moderate`/`hard` or null). Not plan-scoped. Session exercises are never written here (their ticks stay on the session's `activity_log`), so muscle history counts each completion once. |
| `meal_log` | `id` | A meal actually eaten (#97, contract 15): `date`, `at`, `planId`/`activityId`/`replacedLabel` (the scheduled meal it replaced, or null), `name`, `items` (JSON: name, quantity, unit, energyKj, proteinG, carbsG, fatG; null = unknown), `aiTotals`, `confidence`, `assumptions`, `uncertainties`, `source` (`photo-ai`/`manual`), `schemaVersion`, `edited`, `photos` (JSON: id, on-device uri, addedAt, size), `recordedAt`, `updatedAt`. Saved and removed atomically with the replaced meal's completion. Not counted from the plan. |
| `muscle_report` | `id` | `muscle` (inventory muscle-group id), `kind` (`sore`/`injured`), `at`, `clearedAt` (null while active). Clearing keeps the record (#56). |

Rules:

- `date` is the **local calendar date** `YYYY-MM-DD` at the time of the action. The day boundary is local midnight. Never use UTC dates for day keys.
- A missing `activity_log` row means "not done". Undo deletes the row (or sets `count` back).
- `labelSnapshot` keeps history readable after a plan revision renames or removes an activity.
- **Editable window:** today and any past day, so history can be corrected. Future days are view-only in the UI. The data layer doesn't enforce this.
- Observations may have several entries per day and per metric, from several sources. The latest **observed** one is "the value for that day", except that a value the user entered or confirmed beats an integration's on the same day (contract 12). Inferred values are never used as measurements.
- An integration's records are replaced only through `replaceIntegrationObservations(importId, dates, metrics, observations)`: one transaction that removes that integration's records for those days and metrics, then saves the new ones. Nothing else is touched.

## Plan replacement

- **Bundled seed:** a newer seed revision replaces the stored plan only while that plan is still the untouched seed (`origin: seed`). Once the user changes their configuration (07) it's never overwritten.
- Same `id`, higher `revision`: replace silently. History is kept.
- Same `id`, same or lower `revision`: ask before replacing.
- Different `id`: ask before replacing. Records for the old plan are kept, but they're hidden until that plan is re-imported.

## Device preferences

- Choices about this phone (**reminders on/off**, contract 10; **energy display**, contract 11; the last **Health Connect sync**, contract 12) live in device storage (`src/platform/preferences.ts`: the keystore natively, `localStorage` on web). They aren't plan data, tracking history or part of the export. A plan change can't alter them.

## Export and backup

- **Export all data** (app menu, after a confirmation) writes the full-history `pft-export` v1 JSON defined in contract 06: everything from the earliest record through today, with provenance. It's shared through the native share sheet on native and downloaded on web.
- Restore is built and tested at the data layer (`toSnapshot` + `TrackingStore.restore`). A restore UI is not built yet.
