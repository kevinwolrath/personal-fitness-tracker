# Hero Forge Theme 01 — actual application implementation (#79)

This directory contains **screenshots of the production React Native / Expo application**. It is separate from the #77 artwork/HTML approval package. The theme and functional controls are implemented under `src/`, with the root provider in `app/_layout.tsx`.

Branch: `codex/issue-79-hero-forge-app`. The implementation PR records its exact commit SHA and review URL. Do not merge or release without Kevin's review.

## Run the app

```powershell
git fetch origin
git switch codex/issue-79-hero-forge-app
npm ci
npx expo start --web --clear --port 8081
```

If an Expo process already uses port 8081, stop that process in its terminal before starting another. Existing local tracking data is retained. Refresh the browser after rebuilding. The existing localhost:8081 server was also inspected in an isolated browser: header and document title **Body Anvil**, phone background **rgb(16,21,25)**, no page errors. Test-browser records did not touch the user's browser profile.

For an exported production build:

```powershell
npm run export:web
$env:PORT='8082'
node scripts/serve-dist.mjs
```

Open `http://localhost:8082`. For Android development use the existing `npm run android` workflow; this ticket does not change package IDs, signing or Play releases.

## Where to find the implementation

- **Default appearance:** Hero Forge is active when no valid choice is saved. Settings → Appearance switches immediately between **Hero Forge · Theme 01** and **Classic light**, persisted under the additive device key `pft.display.theme`. It never edits plan/tracking records. Failed persistence retains the session choice and shows a retry message. Rapid writes are serialized; a late preference read cannot undo a user's selection.
- **All screens:** shared contextual colours, typography and memoized styles cover Today, Progress, onboarding, configuration/import, menus, sheets, charts, fields, date picker, buttons, reminders and status bar. Classic retains the original palette. Dark foreground and card background roles are separate; card text and orange-button text have their own readable colours.
- **Workout:** existing Full/Short checklist and stable per-variant tick keys remain. Completed rows display below unfinished rows, preserving frozen priority order within each group. Saved tick IDs retain their original plan order. Expanded workout content opens coverage; no large character appears on default Today.
- **Coverage:** open **Muscle coverage & log exercise** in the expanded workout or **Muscle coverage & exercise log** in the existing menu (available on rest days). Coverage reads `loadExerciseHistory` / `exerciseState`. It shows all 14 actual inventory groups, current recovery/coverage, reported symptoms and an accessible named list. The menu/sheet additions do not change permanent app-bar/tab heights or navigation.
- **Reports:** choose a region or list row → **Report sore**, **Report injured**, **Clear report**. These call the existing report/store actions and notify shared readers. Injury/soreness remain distinct from automatic recovery and training priority. Old reports remain in history when cleared.
- **Exercise recording:** the inventory uses existing equipment/avoid/caution eligibility and engine suggestions. Held exercises are explained and remain loggable; suggestions never silently block a sore/recovering group. Strength and duration-based conditioning are labelled separately. Draft dose comes from the workout/plan when present; timed plank metadata supplies a one-set/20-second draft, otherwise a one-rep/set or 60-second conditioning draft requires confirmation. Strength supports reps or seconds; conditioning always uses seconds per round.
- **Idempotency:** each extra-log form retains one submission ID across retries and has a synchronous in-flight guard. Both store adapters upsert by ID. Extra logs do not write session ticks, and session ticks do not write extra logs. The form explains to use the scheduled checklist for scheduled work. Recorded extra exercises can be removed.
- **Exercise details:** primary/secondary muscle names and an optional activation-only map appear in the existing guide; the log picker also shows them. Looking at activation or a guide never marks completion.

## Artwork and accessibility

`assets/hero-forge/app/` contains the six unchanged final #77 PNGs and curved region mappings. No new or substitute artwork was generated for #79. Tests bind every PNG to its exact approved SHA-256 and validate the union of 14 group IDs and front/rear applicability. Native and web SVG image/paths use the same 1024 × 1536 coordinates with proportional rendering; the narrower viewBox trims empty side margins, not the character.

Saved `profile.gender` selects male/female explicitly; absent, other and unknown values use the distinct gender-neutral set. There is no new account or profile question.

Priority has a warm outline; activated primary regions are filled, secondary regions dashed; sore is diagonal hatch and injured is cross-hatch. Text labels and 48 dp list/form controls remain available without relying on colour or tiny SVG targets. Hip flexors are a schematic surface projection under armour, as in the approved package; this is not diagnostic anatomy. Costume orange is not training state.

## Actual visual evidence

- [390 px before/after overview](actual-app-before-after-390.png)
- [Screenshot gallery at 360, 390 and 430 px](screenshots.html)
- [Live localhost:8081 capture](screenshots/390-live-8081-today.png)
- [Today](screenshots/390-hero-forge-today.png), [Progress](screenshots/390-hero-forge-progress.png), [expanded Workout](screenshots/390-hero-forge-workout.png), [Coverage](screenshots/390-hero-forge-coverage.png)

The before/after gallery switches between the retained Classic appearance and Hero Forge in the same application with the same isolated test-plan data. Captures use a frozen date and repository fixtures, not invented personal tracking records. The full browser suite also exercises real chart fixtures. Existing phone visual baselines were refreshed for the intended theme and reviewed as full-screen images/contact sheets; a meal-instruction contrast issue found in review was fixed before delivery.

## Validation results

- `npm run typecheck`: passed.
- Full Jest run across unit/scripts/iOS/Android: **690 passed, 1 failed; 44 suites passed, 1 failed**. The sole remaining failure is the unchanged Windows fixture expectation in `src/repo/__tests__/agentFiles.test.ts` (forward slashes expected, Windows backslashes received). The detector/test files are unchanged from develop; this is not a theme feature failure.
- Final targeted tests: **42 passed** across mapping, profile fallback, reports/history/idempotency, ordering and native theme persistence/race/error cases; **28 passed** in the later unit selection including AA semantic colour contrast and final inventory metadata. Counts overlap; they are not additional full-suite totals.
- Full browser regression across all configured phone sizes: **437 passed, 106 configured skips**, no failures. This includes Today/Progress, setup, Health Connect, import/export, menus, surfaces, responsive sweep, workouts and new Hero Forge cases.
- Final affected-visual/regression pass after contrast/title refinements: **111 passed, 18 configured skips**, no failures. It includes all three real-art profile variants, timed plank input, equipment exclusions, report/clear, activation patterns and double-submission persistence.
- Expo development-server smoke test: **1 passed**. Existing localhost:8081 was separately verified after final title changes, with no runtime errors.
- `npm run check:native`: **passed for iOS and Android**, including Hermes compilation and the bundled character PNGs. No physical-device test or Play release was performed.
- Initial sandbox-only release-script tests could not reach their local fake API; the complete rerun with localhost access passed those tests. An initial production/dev Playwright overlap lost three teardown trace files; separate `test-results-dev/` output removed that collision, and the clean full run passed. No live Google Play API was called.
- No self-hosted CI build was triggered manually. The previously mentioned runner `pwsh` problem is not a locally observed feature failure and is not claimed as fixed here.

### Reproduce checks on this Windows host

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\kevin\AppData\Local\ms-playwright'
$env:PFT_E2E_PORT='8082'
npm run typecheck
npm run build:exercise-assets # restores generated LF content after a CRLF checkout
npm test -- --runInBand --cacheDirectory ./artifacts/jest-79
npx playwright test --workers=4
npm run check:native
$env:E2E_DEV='1'
$env:PFT_E2E_PORT='8091'
npx playwright test --workers=1
```

Localhost permission is required for the browser/local fake-API checks. No package dependencies were added. Plans, account model, storage tables, internal IDs, Health Connect continuity and recovery calculations remain intact. The optional inventory `defaultDose` is log-form metadata; it does not change exercise scoring. Gamification, store artwork/legal work and the remaining #75/#56 acceptance criteria are not closed by this PR.
