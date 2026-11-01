# 04 · Persistence & data ownership

## Ownership

- **All data belongs to the user and lives on the device.** V1 has no accounts, network calls, analytics or telemetry.
- There are two kinds of data, and they never mix:
  - **Plan package**: authored content. The app reads it and never edits it. It can be replaced by importing a new package.
  - **User records**: what happened. They're written only by user actions and never derived from or embedded in the plan.
- **Seed plan:** the app bundles one plan package, `plans/seed.plan.json` (currently the personal weight-loss plan, decided in issue #3). On a fresh install it's validated and copied into storage as the active plan. A later build with the same `id` and a higher `revision` replaces it silently, keeping history. A plan with a different `id` (a future import) is never overwritten by the seed. UI code never reads the seed directly; it only sees the active plan.
- Tracking data is runtime-only and never committed. Only plan packages and generic fixtures live in source control.

## Storage

- **Native:** SQLite via `expo-sqlite`, accessed only through a small repository module, for example `src/storage/`. Screens never run SQL.
- **Web (test surface):** the same `TrackingStore` interface over `localStorage`: one JSON document under `pft:tracking:v1` (decided in issue #3, so no SQLite/WASM in the browser). It falls back to in-memory storage if `localStorage` is unavailable. Platform selection is by file extension (`openStore.ts` / `openStore.web.ts`).
- Both implementations must pass the shared suite in `src/storage/__tests__/store.contract.ts`. The SQLite implementation is tested against Node's built-in SQLite through the same `SqlDatabase` interface expo-sqlite provides.
- Schema migrations are numbered and run on startup. Never destructive without an export first.

## Records (logical model)

| Record | Key | Fields |
|---|---|---|
| `plan` | `planId` | `revision`, `formatVersion`, `json` (verbatim package), `importedAt`. Exactly one active plan. |
| `activity_log` | `planId, date, activityId` | `status` (`pending`, `done`, `skipped`), `count` (for count tracking; `pending` means partial), `labelSnapshot`, `updatedAt` |
| `measurement` | `id` (uuid) | `planId`, `measurementId`, `date`, `value` (in plan units), `recordedAt` |
| `quick_log` | `id` (uuid) | `planId`, `quickLogId`, `at` (ISO timestamp with offset) |
| `day_override` | `planId, date` | `dayTypeId` |

Rules:

- `date` is the **local calendar date** `YYYY-MM-DD` at the time of the action. The day boundary is local midnight. Never use UTC dates for day keys.
- A missing `activity_log` row means "not done". Undo deletes the row (or sets `count` back).
- `labelSnapshot` keeps history readable after a plan revision renames or removes an activity.
- **Editable window:** today and any past day, so history can be corrected. Future days are view-only in the UI. The data layer doesn't enforce this.
- Measurements may have several entries per day. The latest one is "the value for that day".

## Plan replacement

- Same `id`, higher `revision`: replace silently. History is kept.
- Same `id`, same or lower `revision`: ask before replacing.
- Different `id`: ask before replacing. Records for the old plan are kept, but they're hidden until that plan is re-imported.

## Export and backup

- **Export data** (Plan tab) writes one JSON file: `{ exportFormat: 1, exportedAt, plan, records }`. It's shared through the native share sheet on native and downloaded on web.
- Import of a data export is out of scope for V1. The format is defined now so exports stay useful later.
