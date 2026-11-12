# Recommended Resistance Training (#157): layout options

Started from develop 44d44fc on `codex/issue-157-recommended-resistance`.

All options place the new card in Today content after Today's workout and Muscle Growth. No shell/header controls move. The first-content 200px budget and existing workout/routine controls remain. The card recommends one muscle group; expand for equipment-compatible exercise rows and the existing logging/guide flows. Prototypes use illustrative history, never real recommendations.

- **A — Reason first (recommended):** group, optional status and a concise recorded-history explanation. Expand for exercises. Avoids making a coverage target look like a required task.
- **B — Coverage detail:** a small volume meter and training-day count on the card. More visible evidence, but taller and the target could feel like a daily obligation.
- **C — Compact:** smallest collapsed summary; expand for fuller explanation and exercises. Best density, less detail visible initially.

Open `options.html?option=a`, `b` or `c`; add `&expanded` to inspect the exercise list. Images reuse the existing bundled hero exercise art. This is a design prototype, with no storage or app changes.

## Integration plan

Reuse `muscleCoverage`, `suggestExercises`, `eligibleExercises`, `inventoryFor`, `loadExerciseHistory`, `doseFor` and `workoutToggle` rather than introducing parallel muscle, recovery or logging data. Rank only when recorded history supports a comparison. Consider primary/secondary effective load, recent training-day frequency, recovery/reports and remaining scheduled/Muscle Growth workload. Exclude recovering/injured/sore dependent muscles and unavailable/avoided exercises. Keep rest-day and insufficient-history states neutral. Use the existing stable per-day movement log identity; a recommended movement already represented by a session/routine must never create another free log.

Required verification: weighting/ranking explanations, recovery/reports, sparse history, equipment/limitations, planned workload, optional logging/undo/deduplication, native render and complete mobile journey. No configuration schema change.

## Approved implementation

Kevin chose A in chat. The implementation adds `src/exercises/recommendedResistance.ts` as a pure derivation over the existing exercise state and day/routine rows. It reuses the existing history, weighting, window, recovery, eligibility, artwork, doses and stable per-day logging identity. Coverage refreshes on session record changes and minute/foreground clock changes; the workout's frozen before-today display order is retained.

The authoritative behavior is [contract 19](../../design-contracts/19-recommended-resistance.md). Actual phone captures are under `screenshots/`; prototype values above remain illustrative. Test results are recorded in the PR. No new dependency, network service, stored recommendation or configuration schema was introduced.
