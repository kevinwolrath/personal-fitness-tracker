# Supinated cross-body dumbbell curl (#151)

Nine new poses generated with the built-in image generation tool, using the approved orange/charcoal male, female and neutral hero references in `assets/hero-forge/app/`. Each hero has a palms-forward start, right-arm cross-body curl and left-arm cross-body curl. Finish poses reference their own generated start to preserve character identity. Prompts and original output paths are in `art-prompts.json`; original PNGs remain in the generator output directory. Offline JPEG delivery assets are in `assets/exercises/heroes/` (960 × 720, Pillow Lanczos resize, quality 85, optimized). Existing artwork was not replaced.

The shared inventory maps biceps as primary and forearms as secondary. Brachialis is covered by the existing biceps group; no new muscle region was introduced. The guide specifies repetitions per arm and controlled alternating movement. This entry does not modify the seed plan or select itself in Muscle Growth.

Validation: TypeScript passed; Jest passed 1,117 tests (seven existing skips); Android/iOS export and the development-server smoke passed. All nine new hero journeys and twelve existing Muscle Growth journeys passed across 360/390/430 px. Priority (six journeys) and workout logging (three journeys) passed after catalogue-count expectations were updated.

The full browser run covered 702 cases: 574 passed, 111 skipped and 17 initial failures. Five stale catalogue-count assertions were corrected and rerun successfully. Eleven screenshot failures reproduced on unchanged develop (36b5e28): app menu, configuration preview/fixes/error, Health Connect off/on/missing/today, progress overview/charts and settings. Those unrelated baselines were preserved. The remaining workout-extras screenshot intentionally changes because the curl adds an eighth optional exercise; its baseline was reviewed and updated.

Phone screenshots for all nine phases are in `screenshots/`. Static assets are bundled offline for every platform.
