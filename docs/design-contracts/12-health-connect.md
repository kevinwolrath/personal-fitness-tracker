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
  - **Per-type results (#44):** each sync records, per type, whether it was read, couldn't be read, or isn't allowed, with how many records (or days with a total) Health Connect returned and the latest date. These are counts and dates only, never health values, and stored on the device. A successful sync therefore never hides a gap: with no value today, a row says **"Not allowed"**, **"Couldn't read · try Sync now"**, **"None in Health Connect · last N days"** or **"None today · Latest <date>"**. The status line names any type that couldn't be read. When a type has nothing, a help line explains that the data hasn't reached Health Connect and where to check the source app's write access.
  - **Permission check fails** (reading the granted permissions errors on open): the last known connection and imported values stay, the sheet says the check failed, and nothing is shown as "not connected".
  - **Partial access:** only allowed types are read, and only types read successfully are replaced. If one type is revoked between syncs (for example sleep, while steps stays allowed), the next sync refreshes the others and keeps that type's last imported values; the sheet shows it as "Not allowed" and the app doesn't ask again (#43).
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

Provenance: `type: integration`, `importId: health-connect`, `app` = the originating app, `capturedAt` for timed records (#44):
- **Known apps:** stored as a slug (`fitbit`, `samsung-health`, …) and shown by name.
- **The phone itself:** Health Connect's own on-device recording (a `com.android.healthconnect…` origin, or the Health Connect app) is stored as `phone` and shown as **"This phone"**.
- **Any other package:** stored as reported, but **shown as "Another app"**, never as a raw or truncated ID. The package appears only as **App ID** in the value's details, for troubleshooting.
- **Several sources:** a daily total (steps, active energy) keeps every contributing source, comma-separated, named apps first: `fitbit,phone` is shown as **"Fitbit + this phone"**.

Labels read **"Health Connect · Fitbit + this phone"**.

**Not imported:** body fat and every other measurement outside the five types. Both sheet states say so ("Not imported: body fat and other measurements"). Adding one needs another READ permission and a Play declaration change.

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

## Troubleshooting a missing value (device)

The app can only import what Health Connect holds. To check where a value stopped, for example a Fitbit weigh-in at 7:48 am that's missing after a 10:54 am sync:

1. **Does Health Connect have it?** Open Health Connect (Settings → Security & privacy → Privacy → Health Connect, or the Health Connect app on Android 13) → **Data and access → Body measurements → Weight → See all entries**. Look for the entry, its time and its app.
2. **Missing there:** the source app hasn't shared it. In Health Connect, **App permissions → Fitbit**: is **Weight** allowed under "Allow to write"? In the Fitbit app, check its Health Connect sharing. Open Fitbit to let it sync, then check again. Exports can be delayed. The app's 7-day re-read picks up a late record on the next open or **Sync now**.
3. **Present there, missing here:** ☰ → Health Connect. "Not allowed" means turn on Weight for Personal Fitness Tracker in Health Connect → App permissions. "Couldn't read" means tap **Sync now**. "None in Health Connect" while step 1 shows the entry is an app bug: report it with the entry's time and app, not the value.

**Test records** without a real scale: Google's **Health Connect Toolbox** app can insert records. Insert a Weight of 95.5 kg at 7:48 am today, then open this app (or tap **Sync now**). It appears in the Weight tile as "Health Connect · Health Connect Toolbox" (shown as "Another app" unless named) for today's local date. Delete it in Health Connect, sync again, and it disappears here.

## Verification

Automated tests cover mapping, store atomicity, precedence, sync behaviour, failures and UI (unit, native mock, web stand-in, responsive sweep). Merge is blocked until Kevin has tested on a physical Android phone: permission, connection, import, refresh, source attribution and deduplication.
