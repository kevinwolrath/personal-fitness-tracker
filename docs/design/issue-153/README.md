# Kettlebell shrug (#153)

Audit: all 16 prior bundled inventory movements and the legacy cable row have guides for male, female and neutral heroes. The reported shrug was a custom exercise without a bundled definition. The existing custom `kettlebell_shrug` movement now resolves to a bundled guide without changing its catalogue entry, saved doses or history. It is deliberately not added to the built-in inventory: doing so would collide with already configured custom entries and change available workout counts.

Six JPEG phases are bundled through the existing manifest and static Metro requires. Generated with built-in image_gen, referencing each established hammer-curl hero. Prompt set: two equal-width start/end panels; same charcoal/orange character and dark background; full-body front view; round kettlebell in each hand; upright torso and straight arms; shoulders relaxed in phase one, lifted vertically towards ears in phase two; no rolling, elbow curl or head tilt; no text. Each panel is cropped and encoded as an optimized JPEG, using the existing asset workflow.

No missing bundled catalogue exceptions. User-created exercises remain an explicit exception: arbitrary movements cannot be assigned unrelated artwork; their guidance and missing-illustration state remain available. Promote supported custom movements into the shared inventory/library with accurate assets. Coverage tests start from the inventory so missing definitions, phases or hero variants fail.

## Starter-preset exceptions

The broader audit also covers every movement in `presets/exercise-routines.json`. Thirteen preset-only movements have no definitions or hero artwork yet. Each is explicitly tracked in `src/exercises/illustrationExceptions.json` under #158, whose release criteria require correct imagery before My Gym exposes them. Tests reject untracked gaps and stale exceptions. The existing no-guide state remains honest; no generic movement image is substituted.

`bodyweight_squat`, `incline_push_up`, `glute_bridge`, `reverse_lunge`, `dead_bug`, `band_row`, `band_chest_press`, `band_pull_apart`, `dumbbell_row`, `floor_press`, `romanian_deadlift`, `farmer_carry`, `leg_press`.

## Outputs and review

Built-in image_gen outputs are saved as `assets/exercises/heroes/kettlebell-shrug-{male,female,neutral}-{1,2}.jpg`. The prompt set is recorded above and source/reference hashes are in `provenance.json`. Full 390 px screens for both phases and all three heroes are in `screenshots/`; browser visual baselines are in `e2e/__screenshots__/exercise-kettlebell-shrug-*.png`. The reported original phone screenshot was not attached to the issue, so no original before-image is reproduced here. Before this change the same custom movement used the existing missing-illustration state.

The required full phone baseline refresh also brings older captures up to date with previously merged configuration-copy and catalogue-count changes, and current Windows/Chromium text rendering. No unrelated UI components change.
