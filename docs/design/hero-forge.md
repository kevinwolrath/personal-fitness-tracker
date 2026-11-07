# Hero Forge — Theme 01 approval package (#75)

Prepared 7 November 2026. **Awaiting visual approval. Production implementation and merge are gated.**

**Current artwork iteration:** the owner subsequently authorized six corrected AI character views and rebuilt overlays. See [revision 2 summary and validation](hero-forge-preview/README.md) and the [updated interactive preview](hero-forge-preview/index.html). The original artwork/crop descriptions below document the initial preparation; revision 2's `artwork/` and `overlays/` are now the active approval inputs. Production architecture remains a proposal.

Open [the review page](hero-forge-preview/index.html). It includes three mobile mock-ups, the proposed full-height muscle map, Coming Soon, the six approved character views, a numbered anatomical review sheet, an interactive isolated-highlight demonstration and direct reference comparisons. Mock-up buttons depict proposed controls; only the highlight selectors operate. Nothing on this page writes tracking data.

## Reference provenance

Read issue #75 and its single comment across all pages. Downloaded and extracted [the owner's ZIP](https://github.com/user-attachments/files/34508889/hero-forge-reference-images.zip) from [the comment](https://github.com/kevinwolrath/personal-fitness-tracker/issues/75#issuecomment-6701546440), and examined every image:

| ZIP file | Contents | Character coverage |
| --- | --- | --- |
| `character-front-back-options.png` | Approved graphite/orange superhero-lite costumes, human faces and silhouettes | Male, female, gender-neutral, all front/back |
| `hero-forge-character-muscle-map-reference.png` | Coloured character-region guide and legend | All three, front/back |
| `hero-forge-mobile-screens.png` | Today, Strength Workout and Muscle Map | Female appears in workout/map |
| `hero-forge-three-screen-reference.png` | Byte-identical to mobile-screens | Same |
| `muscle-map-three-variants.png` | Byte-identical to character-muscle-map-reference | Same |

Three unique originals are retained unchanged under `assets/hero-forge/references/`. `manifest.json` records source URLs, SHA-256 hashes and duplicate names. The extracted five-file archive remains locally in `artifacts/hero-forge-reference/` (ignored build/download output).

These references are the approved visual design. The new previews retain their characters rather than generating alternatives. Where the concept differs from explicit app contracts, preserve the existing shell, interaction and mobile dimensions required by the owner: compact hamburger header, content high on Today, two tabs, sheets with fixed Close. No large logo/banner or character on Today. Progress has no supplied concept, so it uses the existing Progress layout with the same material/palette treatment.

## Existing features and precise work remaining

Inspected the current `develop` checkout, source, contracts 01/02/05/09/14 and the checked-in Today, Progress and expanded workout screenshots. The preview is a separate HTML design artifact; it is not an Expo route or a working feature implementation.

| Capability | Existing evidence | Work after approval |
| --- | --- | --- |
| Continuous daily log, date/day-type selection, measurements, goals, targets, chronological meals/activities, conditioning alternatives | `DayLogScreen`, `DayHeader`, `MeasurementPanel`, `RequirementRow`, `TargetsLine` | Theme the same controls and preserve their semantics |
| Workout ticks, Full/Short, guide opening, skip/restore and correction | `WorkoutCard`, `ExerciseChecklist`, `ItemSheet`, `ExerciseGuideSheet` | Add themed expanded flow, preserve stable keys and variant handling |
| Fixed-for-day priority order, eligible inventory, rest-day and recovery rules, suggestions, equipment and avoid/caution filtering | `useExerciseState`, `exercises/state.ts`, `coverage.ts`, `inventory.ts` | Wire coverage and suggestions into the expanded flow; no replacement engine |
| Free exercise log and muscle reports | `logExercise`, `reportMuscle`, store `clearMuscleReport` | Build picker, default dose, sore/injured reporting and clearing controls; refresh shared data after writes |
| Progress ranges, week comparisons, measurement/activity/energy/protein charts, goals, chart editing and persistence | `ProgressScreen`, `progress/report.ts`, `progress/series.ts`, `preferences.progressCharts` | Retain all charts and real goal calculations; apply theme |
| Saved profile gender | `plan.profile.gender` optional male/female/other | Select character from this value; no additional question or account |
| Original light appearance | `src/ui/theme.ts`, static imports across components | Add theme registry, provider, persisted selection and migrate consumers without losing light theme |
| Muscle map and anatomical assets | Engine data exists; no on-screen coverage or silhouette yet | Integrate assets/regions, accessible text list and all real #56 controls |
| XP, levels, quests, achievements | Future issue #73 | Reusable Coming Soon sheet via app-menu entry only; no backend, counters, badges or permanent tab |

Only future gamification uses a placeholder. Muscle coverage, exercise logging, recommendations, soreness, injury and clearing must be functional in the implementation. Real weight goals and nutrition/progress targets never route to Coming Soon.

## Palette, materials and typography

Proposed tokens are in `assets/hero-forge/tokens.proposed.json`, deliberately outside production imports until approval.

| Role | Value |
| --- | --- |
| Charcoal canvas | `#101519` |
| Metallic surface / raised | `#20272D` / `#293139` |
| Primary text / secondary text | `#F1F3F4` / `#B5BDC4` |
| Metallic edge | `#53616B` |
| Ember action / soft background | `#FF9E42` / `#35291E` |
| Priority / exercise activation | `#FFBD72` / `#78C9DF` |
| Sore / injured | `#F0C46A` / `#FF9C9C` |

Use existing system font, numeric tabular figures, current spacing scale and existing type hierarchy. Subtle material shading is limited to surfaces, not broad glowing gradients. Orange communicates actions and selected controls. The full-colour anatomical concept is a reference, not an always-on rainbow tracking display.

## Theme architecture proposal

After approval, use a typed theme registry keyed by `classic` and `hero-forge`, each implementing the same semantic colour/type/material contracts. `classic` remains the default and retains its current values. A root ThemeProvider exposes `useTheme()` and memoized theme-specific styles; replace static module-level colour/style captures rather than mutating the exported `colors` object. Existing `ink` serves both foreground and dark-card background, so introduce separate semantic text/card roles before dark theme conversion. Cover modal portals, charts, native controls, status bar, web phone frame and onboarding as well as main screens.

Persist only the selected theme ID using the existing device-preferences adapter (not plan/account data). Missing/invalid IDs fall back to Classic, and failed persistence does not discard the current in-memory selection. Add a Theme section to the existing Settings sheet; a future theme adds a registry entry and optional theme-owned artwork. Theme selection must not change gender or tracking records.

Character resolver: explicit `male` → male; explicit `female` → female; everything else (including absent profile/gender, `other` and future non-binary/unspecified values) → neutral. No gender inference. The neutral character retains the approved short hair, human face, skin treatment and leaner build.

## Assets and 14-region review

`assets/hero-forge/characters/<male|female|neutral>-<front|back>.svg` contains a presentation crop of the original approved artwork, embedded for offline use. Matching `*-regions.svg` contains independently addressable named path groups. `muscle-regions.json` is the renderer-ready path data on a common `0 0 100 260` canvas. The generator owns the crops, measured fit adjustments, region paths and manifest. All art is local; no remote runtime images or new dependencies.

These are **review assets**, not native-ready transparent sprites. They retain part of the approved scene behind each figure. The final native bundling should use one shared local raster source and crop transforms with `react-native-svg`, plus these paths, instead of shipping six copies of the embedded PNG. Verify the renderer on Android; browser rendering alone does not establish native support. If transparent character extraction is desired, that requires an additional art pass and visual review.

| No. | Engine ID | Label / location | Views |
| --- | --- | --- | --- |
| 1 | `chest` | Pectoral regions below clavicle | Front |
| 2 | `upper_back` | Upper posterior torso, including trapezius/rhomboid projection | Back |
| 3 | `lats` | Lateral posterior torso below shoulder blades | Back |
| 4 | `shoulders` | Deltoid caps | Front/back |
| 5 | `biceps` | Anterior upper arms | Front |
| 6 | `triceps` | Posterior upper arms | Back |
| 7 | `forearms` | Forearm regions above cuffs, excluding hands | Front/back |
| 8 | `core` | Anterior abdominal projection | Front |
| 9 | `lower_back` | Lumbar area above pelvis | Back |
| 10 | `glutes` | Posterior buttocks, separate from thighs | Back |
| 11 | `quadriceps` | Anterior thighs, excluding kneecaps | Front |
| 12 | `hamstrings` | Posterior thighs, excluding glutes and knee joint | Back |
| 13 | `calves` | Posterior lower legs, excluding knees/boots | Back |
| 14 | `hip_flexors` | Small schematic anterior-hip/upper-thigh projection | Front |

The reference legend is not identical to the inventory: it has a single Back label and a separate Traps label. Use the exact engine IDs above; do not create a fifteenth group or lose lats. Hip flexors are deep structures; a surface armour region is explicitly schematic. Armour also conceals muscle boundaries. Numbered outlines and isolated highlights are supplied for review, not a claim that the source drawing provides anatomical segmentation. Region boundaries and per-character fit need approval before production use.

## Highlight and state semantics

- Priority: warm outline and `◇ Priority` text. Coverage need comes from the engine, never directly from illustration colours.
- Activated: cyan fill/outline and `● Activated by exercise` text, representing the selected movement's primary/secondary mapping. This does not log a completion.
- Sore: amber diagonal hatch and `≋ Sore` text.
- Injured: rose diagonal hatch and `! Injured` text, distinct from sore and automatic recovery.
- Unknown: original artwork with neutral text. Do not label lack of history as inactivity, injury or overdue.
- Keep coverage, automatic recovery and active reports separate. In the engine, both active sore/injured reports yield `unavailable`; the report kind supplies the distinct label. A clear action uses the report ID, not a colour-state toggle. Recompute after report/log/clear.
- Every region must have a named accessible equivalent in the 14-row list. Colour/hit-testing on artwork is supplementary. Do not rely on tiny visual regions as the sole touch target.

## Interaction and layout contracts

App shell stays 48 dp plus safe inset, tabs 56 dp plus inset. Header and tab controls stay in the shell. Today screen header retains date row, title/day-type and progress; first content remains within 200 dp on 390 × 844. No new Today control or banner is introduced. Current preview first content begins at 185 px.

Workout additions belong to the expanded sheet's **content**, below its fixed shared ModalHeader. The character portrait is confined to a 178 dp summary row; the checklist remains reachable, and narrow screens scroll inside the sheet. Existing collapsed workout card remains compact. Muscle map fills the expanded flow, with a fixed Close action and a scrollable content area; sheets cover the tab bar. Returning from map/guide/picker restores session and scroll state. Production uses the existing Sheet and ModalHeader adapters, not the HTML mock-up.

Priority uses before-today history and remains fixed for the day. Stable-partition unfinished and completed rows only in the display layer, retaining the frozen order within each partition and preserving original exercise keys. Current source does not yet move completed exercises below unfinished; implementation must add this behavior. Never recreate keys from sorted indexes. Variant switching, optional avoided items, caution flags, legacy movements and whole-workout undo remain intact.

Eligible picker uses existing equipment/avoid/caution filtering. Suggestions explain sore/injured/recovering constraints and offer alternatives but never silently block eligible choices. Dose defaults come from the selected prescribed movement or explicit inventory/library policy; validate sets/reps/seconds and keep conditioning time-based. Do not copy the concept's arbitrary equipment, doses, seven-exercise count, status totals, last-trained dates or sore-leg claims into production. Free logs are separate from scheduled ticks, with no double counting. Rest days remain loggable.

Coming Soon belongs to the existing **app-menu sheet**, adding no permanent header or tab height. It has a working Close/back action and explicit unavailable copy. Existing navigation and meaningful goals are preserved.

## Gaps and approval boundaries

1. No Progress reference was supplied. Preview uses the existing chart/card hierarchy with empty states, no fabricated chart dots or measurements.
2. Source art is flattened; independent regions are newly authored SVG review overlays. It is not an anatomically complete mask set. The masks require owner visual review and native renderer verification.
3. The unmodified source costumes have permanent orange panels. Only overlay shapes change in the highlighting demo; costume orange must never be interpreted as tracking status.
4. Character pixels are preserved; scene backgrounds remain in crops. Neutral/female proportions are not replaced with a recoloured male.
5. The concept's large logo conflicts with the required compact app shell. The proposed header retains Body Anvil branding at the existing 48 dp height.
6. Themed one-arm kettlebell row guide illustrations still require a separate art pass. Existing guide instructions and safe equipment remain the source of technique/dose; no replacement machine or invented technique is proposed here.
7. Full app theme selection, native integration, persistence, on-screen #56 controls and regression coverage have **not** been implemented before approval, following issue #75's checkpoint 2 → 3 sequence. No merge, PR, commit or issue comment was made during preparation.

## Validation and next gate

Rebuild with `node scripts/build-hero-forge-preview.cjs`. Render/check with `node scripts/review-hero-forge-preview.cjs` (Playwright browsers must be available; on this Windows sandbox the installed cache needs `PLAYWRIGHT_BROWSERS_PATH=C:\Users\kevin\AppData\Local\ms-playwright`). The checked-in review-results file records artifact validation. Review screenshots at 390 × 844 and the contact/mapping sheets before approving.

Validation performed for this package:

- Artifact review passed: exact 14-ID inventory equality for each character, front/back visibility assertions, 168 isolated highlight/treatment combinations, all reference images loaded, no browser errors, no phone-content horizontal overflow at 360/390/430 px.
- `npm run typecheck` passed.
- Existing unit suites for coverage, state, inventory, prescription exercises and Progress report: **5 suites, 82 tests passed**. Initial Jest execution could not write its sandbox temporary transform cache (`EPERM`); rerunning with `--cacheDirectory ./artifacts/jest-hero-forge` passed.
- Inspected rendered screens and character/highlight sheets against originals and current layout baselines. Artifact checks establish rendering and addressing, not anatomical validation or native integration.
- Native export, full application e2e and theme-specific persistence/accessibility tests are deferred until the approved production change exists. No existing baseline was replaced.

After visual approval: create a separate branch from current `develop`, implement the approved theme and functional controls, update contracts 01/02/09/11/14 as needed, run persistence/fallback/mapping/ordering/report/logging tests and Today/Progress/Classic regressions, native export, e2e and dev smoke; provide device-size screenshots and accessibility results. Visual approval authorizes implementation, not an automatic merge. Merge remains owner-gated.
