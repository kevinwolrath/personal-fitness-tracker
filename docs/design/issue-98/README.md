# Issue 98: guide consistency audit and layout choice

Started from develop `6a6388b` on `codex/issue-98-guide-consistency`. The issue is a current-app acceptance audit; delivered hero poses are reused, not regenerated.

## Findings so far

- Action illustrations and front/rear maps already use the explicit male/female profile and neutral for absent/other/unknown, as required by authoritative contract 09. Historical issue wording asking for female fallback conflicts with that later approved rule; do not silently change existing users.
- Edit setup answers already has a profile-only save path, preserving schedule, meals, activities and targets. Verify the actual journey and hero changes rather than add another selector.
- `ExerciseMuscles` still uses Show/Hide activated muscles and only the bundled inventory. Always-visible activation and shared/custom mappings remain to be addressed.
- Current guide keeps Close fixed and the pager at 4:3, but an expanded full-size body map is tall and appears after instructions.

## 390px options (approval required)

- **A — Compact strip after demonstration (recommended):** retain a readable movement frame and controls, then an always-mounted compact front/rear activation strip with primary/secondary labels before equipment/instructions. Keeps the main task first and removes the extra tap.
- **B — Demonstration and activation together:** a shorter side-by-side visual band. Most information above the fold, but the movement demonstration is smaller on narrow phones.
- **C — Activation summary first:** compact always-mounted activation above the existing movement pager. Muscle information is immediate, while the movement starts lower.

Run `node docs/design/issue-98/build-options.cjs` to regenerate `options.html`; open it with `?option=a`, `b` or `c`. The mock-ups use the existing female push-up pose, approved female front/rear PNGs and the exact existing muscle-region paths. Cyan fills/secondary dashes are activation, not recovery or costume-orange accents. Prescription values are illustrative. No production UI has changed.

All controls remain in exercise-guide sheet content except the existing fixed ModalHeader/Close. No shell/Today header or 200px-budget change. The proposed map sizes are previews for a phone, not tablet/desktop layouts.

## Approved implementation

Kevin chose A — Compact strip in chat. Contract 09 was updated in its own commit. The 4:3 movement pager and fixed Close are retained; the compact activation strip is always mounted below the step caption, before equipment/instructions. The Show/Hide state and control are removed. Figures are about 153dp tall; labels can wrap beneath them on narrow phones or with larger text. Classic light uses the existing readable text tokens.

`buildGuide` now joins the movement to `inventoryFor` and supplies named primary/secondary regions. The strip uses that same result for built-in movements, custom entries and permitted overrides. Unknown mappings and missing custom poses have explicit unavailable states. No new illustration, unrelated fallback pose, schema, dependency or stored data was introduced. Coverage/workout map defaults stay unchanged.

## Acceptance and evidence

| Criterion | Verification |
|---|---|
| Same profile hero in demonstration and front/rear activation | Every one of the 31 bundled movements is checked against the canonical pose manifest and matching map image paths for male, female and neutral, across all three phone widths. Native tests cover absent/other/unknown too. |
| Correct activated regions | Browser tests inspect every rendered region against the movement's primary/secondary arrays: filled primary, dashed secondary, transparent inactive regions. Push-up regressions specifically reject active quadriceps. Approved map/PNG bindings and all 14 region IDs retain existing hash/coverage tests. |
| Always-visible compact layout | No toggle or collapsed state. Figures are bounded below 180dp; activation precedes instructions. Existing responsive sweep covers 320–1280px and enlarged activation text at 320px, fixed Close and normal vertical scrolling. |
| Shared/custom mappings | Pure tests cover all bundled movements, custom holds and permitted overrides. Native/browser tests confirm a custom hold shows its configured core/shoulder mapping without inventing a demonstration pose. |
| Profile changes without reset | The real Edit setup answers → Save profile journey updates both hero sources without reload, while preserving activities, day types, targets, exercise configuration, goals, measurements and seeded exercise history. |
| Fallback policy | Current authoritative contract 09 uses neutral for absent/other/unknown. Historical female-default wording is reconciled with that established rule; no silent default change. |
| Read-only and offline | Full catalogue browsing leaves canonical tracking JSON unchanged. Dedicated paging/offline cases preserve data, and Android/iOS exports include the existing bundled assets. |

Actual 390px push-up captures for male/female/other/unspecified and Classic light are in `screenshots/`. `before-{hero}.png` and `after-{hero}.png` compare the same prior squat-guide baseline and the approved strip for all three heroes. Seven changed phone baselines and full actual screens were visually reviewed. Prototypes remain illustrative history rather than app captures. Physical-device/emulator testing was not performed.

## Validation

- TypeScript and full Jest passed: 111 suites, 1345 tests; 1 suite / 8 tests skipped.
- Initial focused guide/catalogue journeys: 22 passed, 2 skipped, including all 31 movements and all profiles on all three widths.
- Full production browser run: 662 passed, 117 skipped; one early test assumed the male pose filename contained `-male`, whereas its canonical manifest retains a legacy filename. The assertion now resolves the manifest, matching the existing all-movement audit. Corrected dedicated guide journeys: 15 passed across all widths; profile/history preservation: 3 passed; Classic light: 1 passed.
- Android/iOS exports and serial development smoke passed. The first dev attempt encountered a Windows watcher race while another Playwright process deleted temporary trace folders; the serial rerun used output outside the watched tree and passed without application errors.
