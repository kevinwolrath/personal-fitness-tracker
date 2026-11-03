# 12 · Android Health Connect

Imports what the phone already records: steps, active energy, workouts, weight and sleep (#36). It's a persistent, **read-only** integration. Values become ordinary observations (contract 06) and appear in the Daily Log's existing places. There is no separate Health Connect view of the day.

## Rules

- **Read only.** The app never writes, updates or deletes anything in Health Connect. The manifest declares exactly five permissions, and no WRITE permission and no background or history permission:

  | Permission | Why it's needed |
  |---|---|
  | `android.permission.health.READ_STEPS` | Daily step total, shown under Recorded |
  | `android.permission.health.READ_ACTIVE_CALORIES_BURNED` | Daily active energy, shown in the energy display (contract 11) |
  | `android.permission.health.READ_EXERCISE` | Workouts (type and minutes), shown under Recorded |
  | `android.permission.health.READ_WEIGHT` | Weight, in the Daily Log's Weight tile and progress |
  | `android.permission.health.READ_SLEEP` | Time asleep, shown under Recorded |

- **Asking:** the app asks only when the user taps **Connect Health Connect**. It never asks on launch, and never asks again by itself after a refusal. Partial grants are fine: only allowed types are read.
- **Syncing:** on app start, on return to the foreground and on **Sync now**. There is no background sync and no changes token.
  - **Window:** each sync re-reads a window of local days ending today: **30** until a sync has completed, then **7**. It replaces this integration's observations for those days and the types read, in one transaction (`TrackingStore.replaceIntegrationObservations`).
  - **Idempotent:** re-running a sync changes nothing. Edits and deletions made in other apps within the window show up here.
  - **Errors:** a type that fails to read is skipped, and its stored values stay. A failed sync is recorded and shown in the sheet and the menu row. It never blocks the app or the Daily Log.
- **Never overwrites the user:** manual entries and screenshot imports are separate records and are never changed by a sync.
  - **Precedence:** on the same day, the Weight tile shows a value the user entered or confirmed before an imported one (`latestObservation`). Recorded rows list them first.
  - **Read-only here:** an imported value opens read-only, with "Change or delete it there".
- **Disconnecting** happens in Health Connect (**Manage in Health Connect**). It stops future syncs. Nothing already imported is deleted, and manual data is never touched.
- **Unavailable:** on an iPhone or the web, the row reads "Not available on this device". If Health Connect is missing or outdated on Android, the sheet offers **Get Health Connect** or **Update Health Connect** (Play Store). Everything else works as usual.

## Mapping (`src/observations/healthConnect.ts`, pure)

| Data | Observation | How |
|---|---|---|
| Steps | `steps`, one per day, id `hc:steps:<date>` | Health Connect's daily **aggregate**, which dedupes overlapping apps by the user's priority order |
| Active energy | `active_energy` in kJ, id `hc:active_energy:<date>` | Daily aggregate in kcal × 4.184 |
| Workouts | `exercise_session` in minutes, label = title or type, id `hc:exercise:<record id>` | Raw sessions on their local start day. Sessions from different apps that overlap by more than half of the shorter one are the same workout: the longer one is kept |
| Weight | `weight` in kg, id `hc:weight:<date>` | Raw records: the latest of each local day |
| Sleep | `sleep_duration` in minutes, id `hc:sleep:<date>` | Raw sessions on their local **wake-up** day. Asleep stages only (sleeping, light, deep, REM) when the session has stages, else its whole length. Overlapping sessions from different apps are merged, not added |

Provenance: `type: integration`, `importId: health-connect`, `app` = the originating app (a known slug such as `samsung-health`, otherwise the package name as reported), `capturedAt` for timed records. Shown as **"Health Connect · Samsung Health"**.

## UI (option A, app shell layer)

- **Menu → Health Connect**, under Import from screenshots. The detail line is one of: "Off · steps, energy, workouts, weight and sleep", "Connected · synced 7:42 am", "Syncing…", "Last sync didn't finish", "Not installed", "Not available on this device".
- **Sheet, not connected:** what is read (the five types), **Connect Health Connect** (the one primary action), and "The last 30 days come in first". After a refusal: "Nothing was allowed…" and **Open Health Connect**.
- **Sheet, connected:**
  - the last sync and how many days it checked;
  - **Today**: each type's value and source app, or "Not allowed" or "Nothing today";
  - "A value you enter yourself is kept and shown first";
  - **Sync now** (secondary), **Manage in Health Connect**, and how to disconnect.
- **Daily Log:** no new controls. Imported values appear in the Weight tile and the Recorded section.

## Platform

- `react-native-health-connect`. Its config plugin adds the privacy-policy rationale entry points: the `ACTION_SHOW_PERMISSIONS_RATIONALE` intent filter, and the `ViewPermissionUsageActivity` alias for Android 14+. `minSdkVersion` 26 is set with `expo-build-properties`.
- `src/platform/healthConnect.ts` loads the library lazily, on Android only. `healthConnect.web.ts` reports "unsupported" unless an E2E fixture is installed.
- Health Connect lets an app read up to 30 days before its first grant without the history permission, which matches the first sync.

## Google Play

Before a release that includes this reaches testers, Play Console needs:

1. **App content → Health apps declaration:** declare the five read permissions above, each with its use (the table). No write access.
2. **Privacy policy URL** (App content → Privacy policy). It must cover the health data read, that it stays on the device, and that nothing is shared or written back.
3. **Data safety:** declare "Health and fitness" data collected, processed on the device, not shared.

Internal testing may accept an upload before these are approved, but Play can block wider release, or the permissions, until they are.

## Verification

Automated tests cover mapping, store atomicity, precedence, sync behaviour, failures and UI (unit, native mock, web stand-in, responsive sweep). Merge is blocked until Kevin has tested on a physical Android phone: permission, connection, import, refresh, source attribution and deduplication.
