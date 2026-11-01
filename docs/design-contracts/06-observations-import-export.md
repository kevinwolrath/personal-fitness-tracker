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

### Provenance (on every observation)

| Field | Meaning |
|---|---|
| `type` | `manual`, `screenshot` or `integration` |
| `app` | Source app slug (`fitbit`, `renpho`, …); null for manual |
| `capturedAt` | When the source was captured (screenshot EXIF time, ISO with offset) |
| `confidence` | Extractor confidence 0–1; null for manual |
| `importId`, `assetId` | The import session and the screenshot within it |
| `evidence` | The on-screen text the value came from, or the calculation for inferred values |
| `edited` | The user changed the extracted value before saving |

An **import session** (`{ id, createdAt, extractor, assets[] }`) records what was imported and by which extractor (for example `anthropic:claude-opus-5-5`). Each asset keeps its file name, MIME type, capture time and source app. On native it also keeps a durable copy of the screenshot (`storedUri`, in the app's document directory). Web keeps only the file name.

## Screenshot import

Flow: any editable day in the Daily Log → **Import from screenshots** → pick one or more images → **Read** → review → **Save**. Import is an ingestion path, not a destination: each saved observation appears in the Daily Log on its own date (the date shown on screen, or the day import was opened from), in that day's measurement tiles or **Recorded** section.

- **Extraction** is behind `ScreenshotExtractor`. The V1 implementation sends **one screenshot per request** to Claude (`claude-opus-5-5`, vision plus structured output, server-side refusal fallback), so each value traces to exactly one image. Up to 3 requests run in parallel.
  - The extractor returns provider-neutral output (`extractionSchema`).
  - `mapExtraction` (pure) converts it to canonical units, resolves dates, drops anything that can't be stored faithfully (wrong unit for the metric, negative, not a number) and gives a reason for each drop.
- **Network exception (amends 01 and 04):** this is the app's only network call. It runs only when the user taps **Read**, and sends only the screenshots they picked to Anthropic's API, using **the user's own API key**. The key is stored with the device keychain/keystore (`expo-secure-store`); on web, the dev surface, it lives in `localStorage`. There's no backend of ours.
- **Review rules:**
  - Observed values are included by default. Inferred values are shown separately, excluded by default, and saved as `inferred` if included.
  - Every value can be edited (numbers only) or unchecked.
  - Values under 0.8 confidence are flagged "check this".
  - Each screenshot's date can be moved, but never into the future. The default date is the date shown on screen, otherwise the day open on Today.
- **Save** writes the session and its observations atomically (`saveImport`). Several apps can contribute to the same day. Nothing is merged or overwritten across sources.

## Full-history export (`pft-export`, exportVersion 1)

Today → **Export all data (JSON)**. Native opens the share sheet; web downloads the file.

```jsonc
{
  "format": "pft-export", "exportVersion": 1,
  "exportedAt": "2026-11-01T16:50:00+11:00",
  "app": { "name": "personal-fitness-tracker", "version": "0.1.0" },
  "range": { "from": "<earliest record date or null>", "to": "<today>" },
  "counts": { "observations": 0, "activityLogs": 0, "dayOverrides": 0, "quickLogs": 0, "imports": 0 },
  "plans": [{ "planId", "revision", "formatVersion", "importedAt", "plan": { /* package: goals, targets, schedule */ } }],
  "observations": [ /* every Observation, with provenance */ ],
  "activityLogs": [ /* plan activity completions: VR boxing rounds, resistance, skips… */ ],
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
- A breaking change to this shape bumps `exportVersion`. Importers must reject versions they don't know.
