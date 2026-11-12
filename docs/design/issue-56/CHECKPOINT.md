# Issue 56 checkpoint

Selected by Codex after Kevin asked to choose one open issue. Branch: `codex/issue-56-inventory-acceptance`, based on develop `13ed952`. Start/approach documented on issue 56.

Kevin is closing the laptop; save work and resume from this checkpoint.

## Completed

- Read the reconciled issue and current contracts. Preserve existing prescribed counts, My Gym access, current approved Hero Forge maps and Priority/Reports controls. Do not rebuild the engine or redesign UI.
- Added `e2e/inventory-acceptance.spec.ts`: verifies session/extra weighted totals, report/clear persistence, selected Reports view during updates, advisory logging of held choices, reload and rest-day freedom.
- Targeted browser run including existing workout, priority and Hero Forge journeys: **46 passed, 2 intentional skips**, all three phone widths. Log: `artifacts/issue-56-first-browser.log`.
- Actual 390px screenshots: `screenshots/reports-sore.png`, `screenshots/priority-weighted.png`.
- Added native acceptance for CoverageSheet on both iOS and Android. Reports selection/report/clear work. Reproduced actual custom-dose bug: custom default `{ sets: 4, seconds: 35 }` opens as one set because `CoverageSheet.choose` calls `doseFor` without passing the shared `catalogue`. Failure log: `artifacts/issue-56-native-first2.log`.
- Added a second browser test for recovery expiration while coverage remains open. Its pre-fix run was started; inspect `artifacts/issue-56-clock-before.log` before continuing.

## Next

1. Fix demonstrated custom-dose gap with `doseFor(next.movement, plan, today, catalogue)` in CoverageSheet. No production change has been made yet.
2. Check the clock test: CoverageSheet currently reads only `today` from `useClock`, and its load callback does not depend on minute changes, so recovery can remain stale while open. If reproduced, include `nowMinutes` in the load dependency. Use the existing clock/recovery engine. The new test may need a running Playwright clock (`clock.install`/`pauseAt`) rather than fixed Date to simulate elapsed time; inspect existing up-next tests.
3. Run new native/browser tests, then required TypeScript, full Jest, production and dev Playwright, Android/iOS exports. Inspect real screenshots and preserve unrelated existing documentation images.
4. Write an acceptance matrix reconciling historical #56 wording with current authoritative contracts (prescribed counts vs extras; current Hero Forge maps/outlines vs historical silhouette/four-colour requirements). Document physical-device testing honestly.
5. Small fixes inside existing layout need no new design approval. Any new layout requires the usual owner choice.
6. Commit tested fixes, PR into develop with `Closes #56`, check CI and report result. Do not close #56 before end-to-end acceptance passes. No PR exists yet.

No dependency, schema or production behavior changed at this checkpoint. Native failures are deliberate reproductions of the outstanding dose bug, not a completed fix.
