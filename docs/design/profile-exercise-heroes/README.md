# Profile artwork audit

Issue #86 was completed by PR #87, merged into develop on 7 November 2026
(`812391862083a30cc4d23dbf2d5488f19c6bf5d8`). Its implementation deliberately
assigned one hero per exercise, independently of the profile. The gender prop
reached all three guide entry points (day log, item sheet and coverage sheet),
but was used only by ExerciseMuscles, not the demonstration images.

## Selection

The shared guide now resolves each image using the current profile. Explicit
male/female values select those heroes; other, absent and unknown values select
neutral, using the same characterFor rule as muscle maps. Resolution happens on
render, so changing the profile cannot retain a previous character's artwork.

The existing manifest has 32 poses across 16 movements (15 inventory movements
plus legacy cable row). Each movement has just one hero's two poses. Thus only
32 of the 96 poses needed for complete three-character coverage exist. No
replacement artwork was generated or edited.

Where a matching pose exists it is used unchanged. Otherwise the existing
approved front portrait for the profile hero is shown with an explicit portrait
label and exercise-pose-unavailable message. Instructions, captions, navigation
and tracking behavior are retained. **This fixes character identity, but does
not provide the missing 64 exercise poses.** Portraits are not demonstrations.

Automated checks audit every library step for male, female, other, unspecified
and unknown profiles. Native tests change the profile on a mounted guide.
Playwright audits both steps of all inventory movements for three characters,
checks tracking data is unchanged, saves screenshots and compares visual
baselines. Another browser test edits and saves all profile variants through
the app without reloading.

Actual 390 px screenshots are in `screenshots/`; visual baselines are in
`e2e/__screenshots__/exercise-profile-{male,female,neutral}.png`.

Validation: TypeScript passed; focused Jest passed 19 tests across unit, iOS and
Android projects. Production Playwright passed the initial four-test 390 px
run, including baseline capture for all three characters. The subsequent run
without baseline updates passed all 12 tests at 360, 390 and 430 px, including
the three 390 px visual comparisons. Screenshots were visually inspected.
The full repository regression suite was not run.
