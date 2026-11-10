# 12 · Android Health Connect

Imports what the phone already records: steps, active energy, workouts, weight and sleep (#36). It's a persistent, **read-only** integration. Values become ordinary observations (contract 06) and appear in the Daily Log's existing places. There is no separate Health Connect view of the day.

## Rules

- **Read only.** The app never writes, updates or deletes anything in Health Connect. The manifest declares seven read permissions (body fat added in #46; optional distance in #104), and no WRITE permission and no background or history permission:

  | Permission | Why it's needed |
  |---|---|
  | `android.permission.health.READ_STEPS` | Daily step total, shown under Recorded |
  | `android.permission.health.READ_ACTIVE_CALORIES_BURNED` | Daily active energy, shown in the energy display (contract 11) |
  | `android.permission.health.READ_EXERCISE` | Workouts (type and minutes), shown under Recorded |
  | `android.permission.health.READ_WEIGHT` | Weight, in the Daily Log's Weight tile and progress |
  | `android.permission.health.READ_BODY_FAT` | Body fat %, shown under Recorded (#46) |
  | `android.permission.health.READ_SLEEP` | Time asleep, shown under Recorded |
  | `android.permission.health.READ_DISTANCE` | Optional recorded distance attached to matching workouts; never estimated. **Currently off** (see below) |

- **Choosing (#116):** the user ticks which types to import. Before connecting, all six are ticked; **Connect** asks only for the ticked ones. For someone connected before #116, the ticks start as whatever Health Connect allows at that point, and are then stored. Only ticked types are read. Unticking a type stops reading it; what was already imported stays. The choice is device state (`pft.healthConnect.wanted`), never plan data.
- **Asking:** the app asks only when the user taps **Connect Health Connect**, or a row's **Allow <type>** (one type, #116). It never asks on launch, and never asks again by itself after a refusal. Partial grants are fine: only allowed and ticked types are read. After asking, the app reads back what Health Connect allows, because Android may show nothing after two refusals.
- **Syncing:** on app start, on return to the foreground and on **Check again**. There is no background sync and no changes token.
  - **Window:** each sync re-reads a window of local days ending today: **30** until a sync has completed; after that the last **7** days, or **from the day of the last fully successful sync** if that's earlier, at most **90** days (#46). A gap of any length up to 90 days closes itself on the next open. Only a sync that read every allowed type moves that start, so a partial or failed sync's gap is re-read next time. It replaces this integration's observations for those days and the types read, in one transaction (`TrackingStore.replaceIntegrationObservations`).
  - **Idempotent:** re-running a sync changes nothing. Edits and deletions made in other apps within the window show up here.
  - **Per-type results (#44):** each sync records, per type, whether it was read, couldn't be read, or isn't allowed, with how many records (or days with a total) Health Connect returned, the latest date and its source app(s) (#116). These are counts, dates and app names only, never health values, and stored on the device. The app each type last came from is kept across syncs, to name it in a fix. A successful sync therefore never hides a gap: with no value today, a row says **"Not allowed"**, **"Couldn't read"**, **"None in Health Connect · last N days"** or **"None today · Latest <date>"**. The status line names any type that couldn't be read. When a type has nothing, its **Fix** explains that the data hasn't reached Health Connect and where to turn on the source app's write access (#116).
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
| Workouts | `exercise_session` in minutes, label = title or type, id `hc:exercise:<record id>` | Raw sessions on their local start day, retaining IDs, start/end and type. Shared projections retain all source records for drill-down, identify compatible sessions overlapping more than half of the shorter interval, and union all time intervals so even partial overlaps cannot inflate minutes |
| Weight | `weight` in kg, id `hc:weight:<date>` | Raw records: the latest of each local day |
| Body fat (#46) | `body_fat` in %, id `hc:body_fat:<date>` | Raw records: the latest of each local day; values outside 0–100 % are dropped |
| Sleep | `sleep_duration` in minutes, id `hc:sleep:<date>` | Raw sessions on their local **wake-up** day. Asleep stages only (sleeping, light, deep, REM) when the session has stages, else its whole length. Overlapping sessions from different apps are merged, not added |

Provenance: `type: integration`, `importId: health-connect`, `app` = the originating app, `capturedAt` for timed records (#44):
- **Known apps:** stored as a slug (`fitbit`, `samsung-health`, …) and shown by name.
- **The phone itself:** Health Connect's own on-device recording (a `com.android.healthconnect…` origin, or the Health Connect app) is stored as `phone` and shown as **"This phone"**.
- **Any other package:** stored as reported, but **shown as "Another app"**, never as a raw or truncated ID. The package appears only as **App ID** in the value's details, for troubleshooting.
- **Several sources:** a daily total (steps, active energy) keeps every contributing source, comma-separated, named apps first: `fitbit,phone` is shown as **"Fitbit + this phone"**.

Labels read **"Health Connect · Fitbit + this phone"**.

**Not imported:** every other measurement outside the six main types and optional workout distance (heart rate, blood pressure, …). Both sheet states say so ("Not imported: other measurements, such as heart rate"). Adding one needs another READ permission and a Play declaration change.

**A type added later** (body fat, #46) isn't requested by itself from someone already connected: its row says "Not allowed" until they turn it on in Health Connect (**Manage in Health Connect**), where every declared permission is listed.

## UI (option A, app shell layer)

- **Menu → Health Connect**, under Import from screenshots. The detail line is one of: "Off · steps, energy, workouts, weight and sleep", "Connected · synced 7:42 am", "Syncing…", "Last sync didn't finish", "Not installed", "Not available on this device".
- **Sheet, not connected:** the six types as a ticked list ("What to bring in"), **Connect Health Connect** (the one primary action; disabled with nothing ticked), and "The last 30 days come in first". After a refusal: "Nothing was allowed…" and **Open Health Connect**.
- **The sheet scrolls** when its content is taller than the screen (#46), so every action stays reachable.
- **Sheet, connected: the setup checklist (#116, option A):**
  - **"N of M working"** (ticked types), then the last sync and how many days it checked.
  - **What to bring in:** one row per type, with a tick box ("Import <type>", 48dp target) and two checks in one line:
    - **working:** "✓ Allowed · ✓ 82.4 kg today · Withings", or "✓ None today · Latest <date> · <app>";
    - **no data:** "✓ Allowed · ! None in Health Connect · last N days";
    - **needs access:** "! Not allowed";
    - **failed:** "✓ Allowed · ! Couldn't read";
    - **waiting for its first read:** "✓ Allowed · Checking…";
    - **unticked:** "Not imported".
  - **Fix:** a row with a problem has **Fix ▾**. It opens in place, one at a time; the first problem is open when the sheet opens. The fix depends on the problem:
    - **no data:** "Body Anvil can read weight, but none has arrived in the last N days", then three steps: Health Connect → App permissions → **<app>** → **Allow to write** → the type → open that app once. Then **Open Health Connect**. The app named is the one the type last came from, else the named app that sends the most other types (Fitbit on Kevin's phone), else "the app that records it". It also notes that nothing needs fixing if nothing was recorded.
    - **needs access:** **Allow <type>** (Android's dialog for that type), and the route in Health Connect for when Android doesn't ask.
    - **failed:** **Check again**.
  - **Confirming:** **Check again** (secondary), a fix, or coming back from Health Connect re-checks permissions and re-reads. A note at the top then says what changed since the check started: "✓ Weight is working now. 95.2 kg from Fitbit.", "! Weight still isn't arriving.", "! Sleep stopped working.", or "✓ Checked: everything ticked is working." The note clears when the sheet closes.
  - "A value you enter yourself is kept and shown first", what isn't imported, **Manage in Health Connect**, and how to untick and disconnect.
- **Menu row:** with a problem: "Connected · 1 needs a fix" (or "2 need a fix").
- **Platform limit:** Android doesn't tell an app which other apps may write to Health Connect. So "no data" is judged only from records returned for the synced days. It can mean the source app isn't allowed to write, or that nothing was recorded; the fix says both.
- **Daily Log (#104):** Recorded groups steps, active energy and sleep in a compact grid; a content-layer Walking summary expands individual source records (at least 48dp targets). Imported values appear in the Weight tile and the Recorded section.

## Platform

- `react-native-health-connect`. Its config plugin adds the privacy-policy rationale entry points: the `ACTION_SHOW_PERMISSIONS_RATIONALE` intent filter, and the `ViewPermissionUsageActivity` alias for Android 14+. `minSdkVersion` 26 is set with `expo-build-properties`.
- `src/platform/healthConnect.ts` loads the library lazily, on Android only. `healthConnect.web.ts` reports "unsupported" unless an E2E fixture is installed.
- Health Connect lets an app read up to 30 days before its first grant without the history permission, which matches the first sync.

## Google Play

Before a release that includes this reaches testers, Play Console needs:

1. **App content → Health apps declaration:** declare the seven read permissions above, each with its use (the table). No write access.
2. **Privacy policy URL** (App content → Privacy policy). Supply an owner-reviewed, public policy covering the actual health-data use, storage, optional sharing/export and external processing. Verify the Health Connect permission-rationale entry point displays or links the same policy. A native intent filter alone does not provide a policy URL.
3. **Data safety:** the owner must classify the shipped app's actual data flows using Google's definitions. On-device processing alone must not be automatically labelled off-device collection. Optional screenshot extraction sends images and request context directly to Anthropic; user-directed export/sharing and AI configuration must also be reviewed. Do not use a blanket "nothing collected/shared" assertion for the whole app or invent provider retention/security guarantees. See the [Play validation/declaration checklist](../google-play-validation.md).

Internal testing may accept an upload before these are approved, but Play can block wider release, or the permissions, until they are.

## Troubleshooting a missing value (device)

The app can only import what Health Connect holds. To check where a value stopped, for example a Fitbit weigh-in at 7:48 am that's missing after a 10:54 am sync:

1. **Does Health Connect have it?** Open Health Connect (Settings → Security & privacy → Privacy → Health Connect, or the Health Connect app on Android 13) → **Data and access → Body measurements → Weight → See all entries**. Look for the entry, its time and its app.
2. **Missing there:** the source app hasn't shared it. In Health Connect, **App permissions → Fitbit**: is **Weight** allowed under "Allow to write"? In the Fitbit app, check its Health Connect sharing. Open Fitbit to let it sync, then check again. Exports can be delayed. The app's 7-day re-read picks up a late record on the next open or **Check again**.
3. **Present there, missing here:** ☰ → Health Connect. "Not allowed" means tap **Fix → Allow weight**, or turn on Weight for Body Anvil in Health Connect → App permissions. "Couldn't read" means tap **Check again**. "None in Health Connect" while step 1 shows the entry is an app bug: report it with the entry's time and app, not the value.

**Test records** without a real scale: Google's **Health Connect Toolbox** app can insert records. Insert a Weight of 95.5 kg at 7:48 am today, then open this app (or tap **Check again**). It appears in the Weight tile as "Health Connect · Health Connect Toolbox" (shown as "Another app" unless named) for today's local date. Delete it in Health Connect, sync again, and it disappears here.

## Verification

Automated tests cover mapping, store atomicity, precedence, sync behaviour, failures and UI (unit, native mock, web stand-in, responsive sweep). Merge is blocked until Kevin has tested on a physical Android phone: permission, connection, import, refresh, source attribution and deduplication.

## Recorded activity facts (#104)

Distance is optional enrichment, not a daily total or a seventh main status row. Read Distance only when already granted; denial or read failure leaves workouts available without distance. Existing connections enable it through Manage in Health Connect, without an automatic permission prompt. Show this dependency in both connection states. Match raw Distance records only to wholly containing exercise intervals with the same source package; exclude overlapping distance records instead of prorating daily totals. Sum only non-overlapping session distances; label partial coverage as recorded. Never derive distance from steps or elapsed time.

Today, Progress and the connection sheet share activity overlap projections. Raw records remain available. Missing legacy times produce a conservative duration lower bound, labelled accordingly. Display duration as min/hr and distance as m/km, including detail and review screens.

The new READ_DISTANCE permission requires the corresponding Google Play Health Connect declaration before release. **It is off until that declaration exists** (`HC_DISTANCE` in `src/observations/healthConnect.ts`): the manifest doesn't list it, Connect doesn't ask for it, nothing reads it and the sheet doesn't mention distance access. Google Play rejects a release whose bundle requests an undeclared health permission, and the form only lists permissions from an accepted bundle. To turn it on: set `HC_DISTANCE`, add the permission to `app.json`, upload that bundle by hand to internal testing, declare READ_DISTANCE in the Health apps form, then release. No route, background, history or write permission is added. Physical-device permission/source verification remains an owner merge checkpoint; automated/native emulator checks do not replace it.

## Energy and nutrition coverage (audit)

- **Read:** ActiveCaloriesBurned, stored as `active_energy` (one value per day, in kJ). Progress turns it into estimated energy burned by adding an estimated resting energy (contract 14). It is never shown as a total and never added to one.
- **Not read:** TotalCaloriesBurned, BasalMetabolicRate and Nutrition. Each needs a new READ permission declared in Google Play's Health apps form, like READ_DISTANCE (#104/#115), so they are a separate decision.
- **What counts as eaten:** only meals the user logs (photo or typed, including a protein shake logged as a meal) and intake day totals. Ticked planned meals never count.
