# Profile exercise heroes

Every one of the 16 guides has two distinct exercise poses for each of the
three established heroes: **96 bundled JPEGs**. This includes all 15 inventory
movements and legacy cable row. The original 32 poses remain unchanged; the
64 missing poses were generated after the owner's explicit request.

## Root cause and selection

Issue #86 was completed by PR #87, merged into develop on 7 November 2026
(`812391862083a30cc4d23dbf2d5488f19c6bf5d8`). It assigned one hero per exercise.
All three guide entry points passed gender, but the guide used it only for
ExerciseMuscles. The shared guide now resolves the stable library image ID
plus current profile against the manifest's `baseImage` and `hero` fields.
Explicit male/female values select those heroes; absent, other and unknown
values select neutral, using the muscle map's `characterFor` rule. Resolution
happens on every render. No shipped guide needs the defensive portrait
fallback; coverage tests fail if any profile pose is missing.

## Artwork and provenance

Built-in `image_gen` created 32 two-panel sequences using the exact existing
production character PNGs under `assets/hero-forge/app/` as identity references.
No hero was redesigned. `generation-results.json` records final prompts,
reference/source/output hashes, dimensions, byte sizes and source paths.
Two deadlift sequences were corrected for deeper hip hinges and the female
leg raise was corrected for head contact with the floor before adoption.

`scripts/process-profile-poses.py` splits sheets at their midpoint, resizes
proportionally to at most 768 x 1024 and encodes JPEG quality 88. It does not
transform anatomy or equipment. `scripts/register-profile-poses.py` updates
the manifest and static Metro requires. All final project assets are saved
under `assets/exercises/heroes/`; the complete set totals about 7.3 MB.

Each generated sheet was visually reviewed for character identity, distinct
poses, equipment, grip and full body framing. Complete catalogue contact sheets:

- [Male](male-contact-sheet.jpg)
- [Female](female-contact-sheet.jpg)
- [Neutral](neutral-contact-sheet.jpg)

Actual application screenshots for both squat steps and all three heroes are
in `screenshots/`. Three 390 px visual baselines live in
`e2e/__screenshots__/exercise-profile-{male,female,neutral}.png`.

## Verification

- TypeScript passed.
- Focused Jest: 19 passed across unit, iOS and Android. Tests require exactly
  one correct pose per library step/profile, distinct files per sequence,
  96 registry entries, valid file signatures/sizes and mounted profile changes.
- iOS and Android Hermes production exports passed; all 96 JPEG content hashes
  were verified against each platform's exported asset metadata.
- Production Playwright audits both steps of all inventory exercises for all
  three heroes, tracking immutability, saved profile changes without reload,
  actual image loading, sizing and pager alignment. Visual baselines are
  captured and compared in a separate run without snapshot updates.
- Final combined guide/browser run without snapshot updates: **22 passed,
  2 configured skips**, across 360, 390 and 430 px. Four 390 px visual baselines
  passed, including the existing guide baseline and all three profile variants.
- Full Jest suite after fixing logical step IDs in the validation registry:
  **75 suites passed, 899 tests passed, 1 skipped**. The coverage test still
  checks all logical library steps are used; profile variants are separately
  required by the 96-pose artwork checks. Full browser regression was not run.
