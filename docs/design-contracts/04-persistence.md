# 04 · Persistence & data ownership

## Ownership

- **All data belongs to the user and lives on the device.** V1 has no accounts, network calls, analytics or telemetry.
- There are two kinds of data, and they never mix:
  - **Plan package**: authored content. The app reads it and never edits it. It can be replaced by importing a new package.
  - **User records**: what happened. They're written only by user actions and never derived from or embedded in the plan.
- The personal plan is supplied as a plan package at runtime by import (or by a local, git-ignored fixture during development). It's never compiled into UI code.

## Storage

- **Native:** SQLite via `expo-sqlite`, accessed only through a small repository module, for example `src/storage/`. Screens never run SQL.
- **Web (test surface):** the same repository interface. The backend is decided in the proposal (§7, blocker 1). Tests must be able to start from a clean state or a seeded state.
- Schema migrations are numbered and run on startup. Never destructive without an export first.

## Records (logical model)

| Record | Key | Fields |
|---|---|---|
| `plan` | `planId` | `revision`, `formatVersion`, `json` (verbatim package), `importedAt`. Exactly one active plan. |
| `activity_log` | `planId, date, activityId` | `status` (`done`, `skipped`), `count` (for count tracking), `labelSnapshot`, `updatedAt` |
| `measurement` | `id` (uuid) | `planId`, `measurementId`, `date`, `value` (in plan units), `recordedAt` |
| `quick_log` | `id` (uuid) | `planId`, `quickLogId`, `at` (ISO timestamp with offset) |
| `day_override` | `planId, date` | `dayTypeId` |

Rules:

- `date` is the **local calendar date** `YYYY-MM-DD` at the time of the action. The day boundary is local midnight. Never use UTC dates for day keys.
- A missing `activity_log` row means "not done". Undo deletes the row (or sets `count` back).
- `labelSnapshot` keeps history readable after a plan revision renames or removes an activity.
- **Editable window:** today and yesterday. Older days are read-only in the UI. The data layer doesn't enforce this.
- Measurements may have several entries per day. The latest one is "the value for that day".

## Plan replacement

- Same `id`, higher `revision`: replace silently. History is kept.
- Same `id`, same or lower `revision`: ask before replacing.
- Different `id`: ask before replacing. Records for the old plan are kept, but they're hidden until that plan is re-imported.

## Export and backup

- **Export data** (Plan tab) writes one JSON file: `{ exportFormat: 1, exportedAt, plan, records }`. It's shared through the native share sheet on native and downloaded on web.
- Import of a data export is out of scope for V1. The format is defined now so exports stay useful later.
