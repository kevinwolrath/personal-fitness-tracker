# 06 · Observations and full-history export

## Canonical model

```
manual entry / integrations (historical: screenshots) ──▶ Observation (canonical) ──▶ TrackingStore ──▶ JSON export
```

- The app's **own** metric catalog (`src/observations/metrics.ts`) is the model. Fitbit, Health Connect, Google Health, scale apps and the like are only **sources**: they map into catalog ids and never shape the schema.
- An **Observation** is one value about one local date: `{ id, date, metric, value, unit, kind, label, note, source, recordedAt }`.
  - `value` is stored in the metric's **canonical unit**: kg, cm, km, kJ, min, count, score, %, bpm or g. Conversion happens at the boundaries: on import, on manual entry in plan units, and on display.
  - Observations are **not plan-scoped**. A user's weight outlives any plan. A plan measurement's `id` names the metric it shows, so the seed's `weight` and `waist` read observations from any source.
- **`kind`** keeps sources honest:
  - `observed`: the value was displayed by the source (scale screen, app screen) or typed by the user.
  - `inferred`: the value was calculated from other values (for example a starting weight worked out from the current weight plus the total loss). It's stored only if the user explicitly includes it, it's always labelled as calculated, and it's **never** used as a measurement. `latestObservation` returns observed values only.
  - A difference that the app itself displays (for example "−2.55 kg") is observed, under metric `weight_change`.

Optional `activity` facts retain source start/end timestamps, exercise type, recorded distance in metres and a partial-distance flag (#104). They are absent on older records. No distance is estimated; v1 export/restore preserves these additive facts. Display durations with `min`/`hr`, and distances with `m`/`km`.

Energy observations are stored in kJ. How they're *shown* (kJ, kcal or both) is a device preference that never changes the stored value (contract 11).

### Provenance (on every observation)

| Field | Meaning |
|---|---|
| `type` | `manual`, `screenshot` or `integration` |
| `app` | Source app slug (`fitbit`, `renpho`, `samsung-health`, …). For an integration: `phone` for on-device recording, a package name as reported for an unnamed app (shown as "Another app"), and several sources comma-separated, e.g. `fitbit,phone` (contract 12). Null for manual |
| `capturedAt` | When the source was captured (screenshot EXIF time, ISO with offset) |
| `confidence` | Extractor confidence 0–1; null for manual |
| `importId`, `assetId` | The import session and the screenshot within it. For an integration, `importId` names it (`health-connect`, contract 12) and `assetId` is null |
| `evidence` | The on-screen text the value came from, or the calculation for inferred values |
| `edited` | The user changed the extracted value before saving |

An **import session** (`{ id, createdAt, extractor, assets[] }`) records what was imported and by which extractor (for example `anthropic:claude-opus-5-5`). Each asset keeps its file name, MIME type, capture time and source app. On native it also keeps a durable copy of the screenshot (`storedUri`, in the app's document directory). Web keeps only the file name.

## Screenshot import (removed, #138)

The screenshot import, which read values from fitness-app screenshots with Claude, was removed once direct sync (Health Connect, contract 12) covered the same data.
- There's no menu item, no `/import` route, no extractor, no Anthropic API key and no network call for it.
- Any stored API key (`pft.anthropic.apiKey`) is deleted at startup.

**Historical data is kept as it was, with no migration and nothing deleted:**
- observations with `source.type: "screenshot"` and their provenance, shown as "<App> screenshot";
- import sessions (`import_session`);
- retained screenshot files.

All of them are still exported, backed up and restored. Only restore (backups, exports) writes import sessions now; there's no `saveImport`.

## Full-history export (`pft-export`, exportVersion 1)

App menu (☰) → **Export all data** → confirm **Export JSON**. Native opens the share sheet; web downloads the file.

```jsonc
{
  "format": "pft-export", "exportVersion": 1,
  "exportedAt": "2026-11-01T16:50:00+11:00",
  "app": { "name": "personal-fitness-tracker", "version": "0.1.0" },
  "range": { "from": "<earliest record date or null>", "to": "<today>" },
  "counts": { "observations": 0, "activityLogs": 0, "dayOverrides": 0, "quickLogs": 0, "imports": 0 },
  "plans": [{ "planId", "revision", "formatVersion", "importedAt", "plan": { /* package: goals, targets, schedule */ } }],
  "observations": [ /* every Observation, with provenance */ ],
  "activityLogs": [ /* plan activity completions: VR boxing rounds, resistance (with exercisesDone ticks, #28), skips… */ ],
  "dayOverrides": [], "quickLogs": [ /* hunger events */ ], "imports": [ /* sessions + assets */ ]
}
```

- **No lookback limit.** `TrackingStore.snapshot()` returns every record, and `range.from` is the earliest dated record.
- **Built for round-trip:**
  - Every record keeps its stable id or composite key.
  - `toSnapshot(json)` validates and is the exact inverse of `buildExport`.
  - `TrackingStore.restore()` upserts idempotently.
  - Tests prove export → JSON → empty store → restore → identical data on both store implementations.
  - A "Restore from export" UI is not built yet.
- **Additive in version 1 (#28):** `activityLogs[].exercisesDone` (optional) and the completion-event actions `tick`, `untick` and `switch`.
- **Additive in version 1 (#56):** `exerciseLogs` and `muscleReports` (contract 04), counted in `counts` and included in `range.from`. Exports written before them read as empty lists. **#97** adds `mealLogs` the same way (contract 15); photos are listed by their on-device location only, never image data. Day snapshots' sessions gain structured doses (`sets`, `reps`, `seconds`, `avoid`), the `short` version and `doses: 1`; older snapshots only have the `dose` text.
- A breaking change to this shape bumps `exportVersion`. Importers must reject versions they don't know.

## Full backup and restore (#128)

**Export all data** is a readable history. **Back up data** is the recoverable copy: one ZIP with a manifest and SHA-256 checksums, the whole store (in this export format), app-owned device preferences and every attachment (original meal photos, retained import screenshots).

**Restore data** (app menu, and first-run setup on a fresh install) validates everything first:
- the ZIP, safe paths and size limits;
- the manifest and backup version;
- every checksum and the store schema;
- that every attachment a record points to is present;
- free space.

It then previews the backup and replaces all local data atomically, only after explicit confirmation. Nothing is merged. Any failure rolls back to the previous data and files.

Secrets (API keys), Health Connect permissions and sync state, notification permission and device-only state are never included.

Format, compatibility policy, limits and the manual post-deployment check: `docs/backup-restore.md`. Code: `src/backup/` (pure archive and service) and `src/platform/backupFiles(.web).ts`.

## Share this day (#76)

The date row's **Share** (contract 02) shares a short text about the **selected date** through the system share sheet.
- **Android:** ACTION_SEND, text/plain, with the system chooser. The user picks ChatGPT, Claude or any other app; no target is hard-coded and there's no API, account or key.
- **Web (dev and test surface):** the Web Share API, else the text is copied to the clipboard and the app says so.
- **Not shown on future dates.**

**Preview first.** A sheet shows the exact text, notes when it includes the user's weight, and offers **Cancel** (nothing is shared) or **Share**. One pure formatter (`src/share/dailySummary.ts`) produces the string, so the preview and the shared text are identical.

**The text:**
- **Instruction first:** "Review my daily fitness activity for weight loss. Flag concerns and suggest one practical improvement. Be concise; don't invent missing data."
- **Heading:** "Body Anvil — Daily activity — Mon 2 Nov 2026 (Home day)".
- **Weight:** the latest weigh-in recorded **on that date** (never an earlier one carried forward; inferred values aren't weigh-ins), with the plan's target.
- **Plan counts:** done, skipped and pending, with the same rule as the day's progress.
- **Strength session:** exercise by exercise. Ticked exercises carry their prescribed dose; the rest are listed as pending. A skipped session says so.
- **Extra exercises:** with their logged dose.
- **Conditioning:** which alternative was done or started, with its rounds.
- **Meals:** labelled "checklist, not intake".
- **Other items:** each with its state. A label that repeats on the day (two school runs) gets its time.
- **What's left out:** anything not recorded. No calories, no planned durations shown as time done.
- **Empty day:** "No activity logged."
- **Format:** dates and times use one fixed format ("Mon 2 Nov 2026", "8:30 am"), whatever the device locale.

## Health data sync and AI share links (#134)

Menu → **Health data sync**. The backend (Cloudflare Worker + D1) is Questspire Studio's; the app side follows `docs/health-sync-api.md`. Code: `src/healthSync/` (pure payload, client, service) and `src/features/health-sync/HealthSyncSheet.tsx`.

- **Document:** `body-anvil-health` schemaVersion 1, built from the stored records (never the plan's planned meals as eaten). Each value keeps its date, unit and provenance (source type, app, confidence, edited). Sections: `plan`, `body`, `activity`, `sleep`, `nutrition` (daily totals + logged meals), `training` (check-offs, exercises, muscle reports), with `coverage` dates and `counts`. **Never included:** the display name, meal photos and screenshots or any text read from them (`evidence`), location (none recorded), credentials.
- **Sync my data:** sends the complete history after a confirmation that shows what's sent and its size. The first sync links the phone (enrollment with the data ID and a random enrollment secret saved before the request, so a retry is idempotent); later syncs replace the latest snapshot. The last success, size and any error are shown. Never automatic.
- **Owner token:** issued by the server, stored only in secure storage with its data ID; never in the database, a backup, an export, a URL, a log or a shared document. A restored backup brings the data ID but not the token.
- **API address (#146):** a build setting (`EXPO_PUBLIC_BODY_ANVIL_API_URL`; Play builds use the GitHub variable `BODY_ANVIL_API_URL`). There's no entry field and no default. Release builds require https. Without a valid address, sync and sharing are off and the sheet says why.
- **Enrollment key (#136):** built into the app (`EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY`; Play builds get it from the GitHub secret `BODY_ANVIL_ENROLLMENT_KEY`). It's never entered, shown or stored, and is sent only as `X-Enrollment-Key` on the first link and its retries. A build without it can't link a new phone and says so before sending anything. A rejected key is explained, and the data ID and retry secret are kept. Linked phones don't need it.
- **View the server copy:** read-only; never written into local data.
- **Share my details:** choose the period (7/30/90 days or all) and categories, preview exactly the document that will be shared (summary and the JSON), pick expiry (1 h or 24 h), create a read-only link, **Copy AI link** (link + a ready-to-send instruction), revoke. Explains that anyone with the link can read it until expiry or revocation, and that AI chats may keep copies. **Share as text instead** is the fallback for AIs that can't open links.

