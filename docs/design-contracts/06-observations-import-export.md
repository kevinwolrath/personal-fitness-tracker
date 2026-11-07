# 06 · Observations, screenshot import and full-history export

## Canonical model

```
screenshots / manual entry / future APIs ──▶ Observation (canonical) ──▶ TrackingStore ──▶ JSON export
```

- The app's **own** metric catalog (`src/observations/metrics.ts`) is the model. Fitbit, Health Connect, Google Health, scale apps and the like are only **sources**: they map into catalog ids and never shape the schema.
- An **Observation** is one value about one local date: `{ id, date, metric, value, unit, kind, label, note, source, recordedAt }`.
  - `value` is stored in the metric's **canonical unit**: kg, cm, km, kJ, min, count, score, %, bpm or g. Conversion happens at the boundaries: on import, on manual entry in plan units, and on display.
  - Observations are **not plan-scoped**. A user's weight outlives any plan. A plan measurement's `id` names the metric it shows, so the seed's `weight` and `waist` read observations from any source.
- **`kind`** keeps sources honest:
  - `observed`: the value was displayed by the source (scale screen, app screen) or typed by the user.
  - `inferred`: the value was calculated from other values (for example a starting weight worked out from the current weight plus the total loss). It's stored only if the user explicitly includes it, it's always labelled as calculated, and it's **never** used as a measurement. `latestObservation` returns observed values only.
  - A difference that the app itself displays (for example "−2.55 kg") is observed, under metric `weight_change`.

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

## Screenshot import

Flow: app menu (☰) → **Import from screenshots** → the platform picker opens straight away → pick one or more images → **Read** → review → **Save**. Import is an ingestion path, not a destination: each saved observation appears in the Daily Log on its own date (the date shown on screen, or the Daily Log day the menu was opened from; a future day falls back to today), in that day's measurement tiles or **Recorded** section.

- **Extraction** is behind `ScreenshotExtractor`. The V1 implementation sends **one screenshot per request** to Claude (`claude-opus-5-5`, vision plus structured output, server-side refusal fallback), so each value traces to exactly one image. Up to 3 requests run in parallel.
  - The extractor returns provider-neutral output (`extractionSchema`).
  - `mapExtraction` (pure) converts it to canonical units, resolves dates, drops anything that can't be stored faithfully (wrong unit for the metric, negative, not a number) and gives a reason for each drop.
- **Network exception (amends 01 and 04):** this is the app's only network call. It runs only when the user taps **Read**, and sends only the screenshots they picked to Anthropic's API, using **the user's own API key**. The key is stored with the device keychain/keystore (`expo-secure-store`); on web, the dev surface, it lives in `localStorage`. There's no backend of ours.
- **Review rules:**
  - Observed values are included by default. Inferred values are shown separately, excluded by default, and saved as `inferred` if included.
  - Every value can be edited or unchecked. Values are shown the way the Daily Log shows them: "13,765" steps, "7h 45m" for durations. Editing accepts that form or plain numbers ("7h 50m", "7:50", "470"; "13765"; "97,25").
  - Values under 0.8 confidence are flagged "check this".
  - Each screenshot's date can be moved, but never into the future. The default date is the date shown on screen, otherwise the day open on Today.
- **Save** is the screen's one primary action. It appears in a fixed bottom bar once there are values to save; until then **Read** is the primary. **Forget key** sits at the end of the content, away from Save.
- **Save** writes the session and its observations atomically (`saveImport`). Several apps can contribute to the same day. Nothing is merged or overwritten across sources.

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
- **Additive in version 1 (#56):** `exerciseLogs` and `muscleReports` (contract 04), counted in `counts` and included in `range.from`. Exports written before them read as empty lists. Day snapshots' sessions gain structured doses (`sets`, `reps`, `seconds`, `avoid`), the `short` version and `doses: 1`; older snapshots only have the `dose` text.
- A breaking change to this shape bumps `exportVersion`. Importers must reject versions they don't know.

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
