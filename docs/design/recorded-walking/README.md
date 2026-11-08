# Recorded walking — issue #104

Actual application captures with the isolated QA fixture in
`e2e/fixtures/walking-health-connect.json`, not personal tracking history.
The Body Anvil theme, artwork, app shell and Today header are retained.

| Before | After |
|---|---|
| ![Before](before-390.png) | ![After](after-390.png) |

![Expanded source records](after-expanded-390.png)
![Record detail with activity time and distance](after-detail-390.png)
![Progress uses the same overlap-safe duration and recorded distance](after-progress-390.png)

The four source records cover 08:00–09:15 and 10:00–10:30. Summing their
durations would incorrectly give 135 minutes; the union is 105 minutes
(`1 hr 45 min`). One nested record is identified as a source overlap. Both
partially overlapping records remain inspectable. The summary says **4 records**,
not four unique walks.

Only non-overlapping recorded distances contribute to the summary: 3,000 m and
1,800 m = **4.8 km recorded**. The overlapping 3,200 m and 1,200 m remain visible
on their individual records. Nothing is scaled, extrapolated or derived from steps.
With no distance supplied, only duration is shown.

The compact grid uses one shared Health Connect label and individual source names.
Tiles, walking expansion and source rows retain targets of at least 48dp.
Rows wrap essential values. The detail sheet scrolls with Close fixed.
Larger native font scales let tiles wrap to fewer columns.

## Data and permissions

Source IDs are retained. Shared pure projections handle duplicate counts,
interval union, conservative distance totals and legacy records without timings.
Today, Progress and the connection sheet use these projections. Incomplete
timings produce a labelled duration lower bound. Manual and screenshot records
keep their existing behavior.

SQLite migration 6 adds nullable activity facts, preserved in both stores and v1
export/restore. Existing observations are not rewritten by the migration.

Distance is a seventh, optional **read** permission. The six main types still
work if Distance is refused, revoked or fails. Existing connections can allow
Distance through Manage in Health Connect; sync never prompts automatically.
Only same-source Distance intervals fully contained in a workout are eligible.

Before Google Play release, update the Health Connect declaration for
`READ_DISTANCE` and verify the grant and source data on a physical phone
(contract 12). No route, background, history or write permission is added.
No Play changes or releases are submitted by this issue.

## Verification

- TypeScript: passed.
- Complete Jest suite: 768 tests, 58 suites passed (unit, Android and iOS).
- Final focused Jest run: 87 tests, 8 suites passed after the final unit/source-matching changes.
- After the native large-text adjustment: 8 relevant tests / 3 suites and TypeScript passed.
- Focused production E2E: 102 passed across 360, 390 and 430 px, covering Health Connect, walking, historical corrections, upcoming durations and scrolling.
- Android and iOS production bundle exports: passed.
- Development-server smoke: passed, including screenshot import.
- Complete exercise-guide inventory: passed on retry with a 120-second timeout (26.1 seconds).
- Refreshed and visually inspected only affected Health Connect and 10:45 upcoming-duration baselines. The unrelated 11:45 due-card baseline was retained.

The broad production E2E run was **not green**: 434 passed, 108 skipped, 25 failed
under concurrent native-build load. Three old `35m` assertions were corrected to
`35 min` and pass in the focused rerun. The scrolling and guide-inventory timing
failures also pass on retry. Other failures comprise 16 unrelated visual-baseline
comparisons, three browser clipboard cases and the small-phone meal-row case.
Those baselines and behaviors were not rewritten to make this issue pass.

## Native Android verification

Built and sideloaded the standalone APK on a dedicated Android 14 / API 34
emulator (1080 × 2400, 420 dpi, Australia/Sydney). Existing AVDs and the connected
phone were not modified. These captures use the same clearly isolated QA records,
shifted to 8 November; the real mapping and SQLite store created the fixture.
They verify native rendering and interactions, not a real Health Connect provider
grant/read or physical-device sync.

| Compact | Expanded | Record detail |
|---|---|---|
| ![Native compact summary](android-compact.png) | ![Native records](android-expanded.png) | ![Native detail](android-detail.png) |

| 200% text: tiles and summary | 200% text: scrollable details |
|---|---|
| ![Large-text native summary](android-large-text.png) | ![Large-text native detail](android-detail-large-text.png) |

Verified tile reflow, readable duration/distance, source-record expansion and
detail navigation at native font scales 1.0 and 2.0. At larger sizes, detail facts
stack vertically so labels stay whole. The detail body scrolls while Close stays
fixed. The installed manifest includes `READ_DISTANCE`; permission is optional
and was not granted as part of this fixture-based rendering check. Physical-phone
permission/source verification remains required before merge under contract 12.

[Native Today](android-today.png) · [200% expanded records](android-large-expanded.png)

Local APK: `artifacts/personal-fitness-tracker.apk` (not committed), SHA-256
`8c4d9711670f84eac94f79b09d5a26d4d9022139a4d32d11607cc4698e49c872`.
Native compilation and the final source refresh succeeded; the embedded Hermes
bundle runs without Metro. Close was pressed successfully after scrolling the
200% detail sheet. The dedicated test emulator was stopped after verification.
