# My Gym (#158): layout review and implementation map

Started from develop after #162 merged (77933e9). Kevin approved B's expandable grouping with A's compact image rows and explicitly authorized implementation, testing, PR and merge without another design approval.

## Layout options (390 x 844)

- **A: Compact image rows (recommended).** Search and selected-only filter above categorized rows. Recognizable equipment thumbnail, exercise count, checkbox. Category bulk controls stay with category headings; multi-gym stations are individual entries. Best density for a comprehensive searchable checklist.
- **B: Expandable equipment groups.** Compact category summary cards, with individual station checkboxes inside each machine group. Strongest machine/station hierarchy; more expansion taps to browse everything.
- **C: Visual equipment tiles.** Two columns with larger images and checkboxes. Strongest visual recognition; fewer entries fit and multi-gym station groups need a detail view.

Open `options.html?option=a`, `?option=b` or `?option=c`. Screenshots are `option-a.png`, `option-b.png`, `option-c.png`; `comparison.png` shows them together. Search, selected-only filtering, checkboxes and larger-image details are interactive prototype controls. Numbers and catalogue slices are illustrative, not production mappings. Equipment silhouettes depict the named items; final assets must pass the image-coverage gate. No prototype data is written into the application.

Common detail treatment: larger equipment image; individually selected stations/functions; supported exercises with the existing profile-hero guide images and swipeable guide. No generic hero portrait as an equipment or movement substitute. Imported or user-created movements without artwork need an explicit development state and cannot silently become finished shipped catalogue entries.

## Layers and vertical budget

My Gym opens from existing app-menu content. The sheet header owns Close and My Gym. Search, filters, bulk category controls, equipment checkboxes and station controls belong to sheet content. No new app-shell buttons, Daily Log header rows or Today cards. Today's content stays within contract 02's existing 200 px budget. Use the existing Sheet/ModalHeader/ScrollView adapters, with no visible scroll indicators. Selections apply immediately with an Undo affordance; import/export keeps the existing configuration validation/preview workflow.

## Current code and integration risks

- `src/plan/schema.ts`: `exercise.equipment` has 21 broad equipment types plus labels/brand/weights/notes. No machine-instance or station identity exists. Preserve configured metadata and kg values; do not infer slab conversions.
- `src/exercises/inventory.ts`: `eligibleExercises` accepts any one equipment type and filters avoid limitations. It is the main place to centralize equipment support, but a broad `home_gym` currently enables every machine movement.
- `src/exercises/catalogue.ts`: `inventoryFor`, Muscle Growth options/day and custom exercise validation. Retain the same muscle inventory and recovery/injury rules.
- `src/exercises/todayWorkout.ts`: includes planned exercises even when they are outside eligible extras. Preserve existing plans as review-needed entries, never silently rewrite them; prevent them being offered as new compatible choices.
- `src/presets/exercisePlan.ts`: starter routine selection uses separate broad equipment kinds. It must consult the shared capabilities rather than remain an independent availability rule.
- `src/features/daily-log/DayLogScreen.tsx`, `useExerciseState.ts`, Muscle Growth editor, free-log picker and guide entry points all need the same derived availability result.
- `src/config/` and contracts 03/04/06/07/09: extend the existing config sections, diff/preview, validation, undo, exports/backups and additive migration path. Avoid a second persisted equipment checklist.
- `src/exercises/illustrationExceptions.json`: 13 preset-only gaps from #153 must be resolved before My Gym release. The existing custom kettlebell shrug guide is reusable without promoting its ID into the built-in inventory and invalidating saved custom config.

## Implementation sequence after layout choice

1. Normalize app-owned equipment/station definitions with stable IDs, categories, recognizable thumbnail/detail images, and explicit capability mappings. Include free weights, racks/benches, selectorized machines, cables, cardio, bodyweight, bands, functional training, boxing and VR.
2. Extend the existing canonical equipment configuration with catalogue/station identities. Migrate existing metadata without selecting unknown stations. Legacy multi-gyms requiring station review must be explicit; never assume that every Fortis station exists.
3. Introduce one pure support resolver for alternative complete equipment combinations (e.g. dumbbells OR barbell plus plates plus bench), empty requirements for bodyweight, and existing avoid/caution behavior. Use it at every selection/recommendation entry point, including #157 integration.
4. Build the chosen checklist and shared image-detail treatment. Persist each selection, preserve historical logs, flag incompatible scheduled workouts for review, and provide undo without rewriting the schedule.
5. Supply accurate offline equipment/station art and missing movement phases for all three heroes. Use static bundled references, stable image sizing, accessible labels, lazy detail loading and image-completeness tests.
6. Verify mapping alternatives, station isolation, image coverage, each picker/builder, persistence, legacy migrations, config import/export/preview/undo, history preservation and offline Android bundling/native rendering. Run the repository's required full checks and inspect phone screenshots.

## Status

Implemented the approved hybrid. My Gym configures equipment access only: 75 equipment/station items in 13 groups, one canonical configuration list and shared availability for 31 illustrated movements. Existing prescriptions, doses and history are preserved. Format 9 supports exact station IDs, availability flags that retain metadata, and complete custom equipment alternatives. All 13 preset-art exceptions are resolved. Validation results are recorded in the PR.

## Assets and provenance

The 75 equipment SVGs are saved in `assets/equipment/`; the generator and bundled registry are `scripts/build-gym-art.cjs` and `src/equipment/artwork.generated.json`. Existing hero art is reused and 78 additional phase JPEGs are saved at `assets/exercises/heroes/{movement-with-hyphens}-{male,female,neutral}-{1,2}.jpg` for the 13 formerly missing starter movements. These were generated with built-in image_gen using the existing character references. `generation-results.json` records the exact prompt set, sources, output paths, dimensions, sizes and hashes; `art-revisions.json` records the farmer-carry stride correction. The seven pose-review sheets were visually inspected, along with full source images where detail needed confirmation.

The real mobile screenshots are under `screenshots/`; option-a/b/c and comparison.png remain the historical layout choices. The authoritative behavior is [contract 18](../../design-contracts/18-my-gym.md).
