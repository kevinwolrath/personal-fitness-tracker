# Issue 56: current-app inventory acceptance

Reconciled against develop `13ed952` and authoritative contracts 08, 09, 18 and 19. The existing inventory, priority/recovery engine, artwork and tabs are retained. Integration defects were reproduced in custom logger doses and live recovery refresh. The acceptance audit also exposed the Extras expander's missing web accessibility state.

## Acceptance matrix

| Requirement | Current implementation and evidence |
|---|---|
| One shared inventory; equipment and limitations | `inventoryFor`, `eligibleExercises` and My Gym's shared resolver. Existing inventory, My Gym, guide and Hero Forge tests cover bodyweight-only, independent stations, avoid/caution and custom entries. No second tracking list. |
| All eligible strength choices; correct counts | Today's workout preserves prescribed full/short counts; Extras contains the remaining eligible catalogue. This follows the later #90/#110 decisions and contract 08, rather than restoring a catalogue-wide plan count. Conditioning stays in its own activity. |
| One-tap completion, undo, repeats and persistence | Existing `workout.spec.ts` plus `inventory-acceptance.spec.ts`: stable free-log identity, session tick rather than free log for planned movements, completed extras move last, undo restores the frozen slot, repeating/reloading retains one log. Extras opens by default on an unprescribed day; its web expanded state is now explicitly exposed, alongside the existing native state. |
| Adaptive next-day ordering | Shared before-today history freezes today's ordering. The new next-day journey compares untrained calves with already-trained quadriceps, logs calves, undoes/repeats, then checks that tomorrow's order and recovery reflect the recorded work. Existing priority/coverage unit tests cover secondary overlap and no forced rotation. |
| Live primary/secondary totals | New browser journey ticks a chest-press session (chest 3, triceps 1.5 effective sets), combines prior pulldowns and a new hammer-curl extra (biceps 3), and verifies persistence without duplicating the session as a free log. |
| Priority/Reports functionality | New browser and Android/iOS native acceptance verifies actual tab selection, empty Reports state, sore → injured → cleared reports, cleared history, retained selected tab during updates and continued advisory exercise access. Existing Hero Forge tests verify actual overlay/pattern changes, distinct legends and all 14 named rows. |
| Recovery while open | Pre-fix browser regression retained Recovering after the stored expiry. Coverage now refreshes from the existing clock/engine on minute and foreground changes. No recovery constants or algorithm changed. |
| Shared custom doses | Pre-fix iOS/Android regression opened a configured 4 × 35-second hold as 1 set. Passing the shared catalogue to the existing `doseFor` fixes sets, dose unit and amount. Native/browser regressions confirm no work is recorded just by viewing. |
| Rest days and unrestricted choices | New journey and existing workout tests verify a neutral rest-day message and continued eligible logging. Reports/recovery affect priority, never silently remove ordinary optional inventory choices. The separate #157 recommendation correctly has stricter eligibility. |
| Maps, accessible cues and guides | Current approved Hero Forge front/rear maps, warm priority outlines, explicit status text and separate report hatching follow contract 09. These supersede the historical black-and-white silhouette and four-colour mock-up wording; this ticket does not redesign approved art. Existing guides remain read-only and use shared mappings. |
| Phone layout and native paths | Existing 320–1280px sweeps, fixed Close/scroll-indicator journeys and actual 390px captures remain applicable. Android/iOS Jest render the real coverage controls; both native exports bundle offline artwork. Physical-device/emulator testing was not performed. |

## Scope of production changes

`src/features/muscles/CoverageSheet.tsx` adds the existing clock's minute to the coverage-load dependencies and supplies the shared catalogue to `doseFor`. `TodayWorkout.tsx` exposes the existing Extras state through `aria-expanded` on web, retaining native accessibility state. No new UI controls, layout, persistence, configuration version, dependency, artwork or business-rule engine.

## Visual evidence

`screenshots/reports-sore.png` and `priority-weighted.png` show the actual app's report/priority distinction and recorded totals at 390px. They were captured before the fixes in checkpoint e6bffbe and regenerated afterward with the same fixture; layout is unchanged. `custom-dose.png` shows the corrected custom draft. Pre-fix numeric evidence is the native regression failure (expected 4 sets, received 1), and pre-fix recovery evidence is the browser regression failure after expiry. No synthetic or edited screenshot is presented as an app capture.

## Final validation

- TypeScript passed. Full Jest: 109 suites / 1321 tests passed; 1 suite and 8 tests intentionally skipped.
- Production browser suite: 641 passed, 115 skipped; 3 new expansion-state assertions exposed the missing web attribute (one per viewport). After correction, final inventory/workout journeys: 31 passed, 2 skipped across all three widths. All 19 responsive scenarios passed, including Priority/Reports at 320–1280px with the last muscle row reachable and Close fixed.
- The responsive checker now excludes intentionally cropped SVG descendants from document-boundary checks while still checking the visible SVG viewport, HTML content and parent clipping; it already used that distinction for parent bounds.
- Android/iOS native exports and development boot/measurement smoke passed. Final coverage/workout native regressions: 4 suites / 8 tests passed.
- Existing visual baselines matched. Actual screenshots were inspected at 390px; no new design or artwork was introduced.

Self-hosted CI results are recorded in the PR. The initial checkpoint is preserved in `CHECKPOINT.md` as historical context; its pending instructions are no longer the current implementation state.
