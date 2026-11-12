# 18 - My Gym: equipment access (#158)

My Gym determines equipment access, never workout prescriptions. Kevin approved B's expandable groups with A's compact image rows, search and per-group bulk selection. No further design gate is required for this implementation.

## Surface and controls

Open My Gym from the existing app-menu content. Its sheet uses the established Sheet, ModalHeader, ScrollView, theme and native adapters. Search, All equipment / Selected only, group counts, expansion, bulk controls and item checkboxes are sheet content. Every visible equipment item has a recognizable fixed-size thumbnail, name and checkbox. Search shows matching items without requiring group expansion. Details show the larger version of the same equipment image, saved metadata and compatible exercise guides using the profile hero. Closed groups and detail images mount only when opened. No shell, Daily Log header or Today-card control is added; the existing 200 px Today budget remains.

## Canonical data and migration 9

The only persisted equipment-access list is `plan.exercise.equipment`. The normalized app-owned definitions are `src/equipment/catalogue.json` (75 items/stations in 13 groups). Each configured item keeps its existing type, label, brand, actual weightsKg and notes, plus optional `catalogueId` and `available` (formatVersion 9). Absent available means true; false removes access while retaining all metadata. Re-selecting the item restores the same saved details. Multiple legacy instances of the same item may retain distinct weights or notes; they grant one shared capability.

`migrateEquipmentV9` identifies known legacy types on the first equipment edit. It preserves unknown entries and metadata, invents no weights, and maps an unspecified home_gym to a frame with no stations. A frame or brand never grants all functions. Each multi-gym station is selected independently. Unconfirmed legacy machines need station review. Existing format 1-8 plans remain readable; new changes use version 9. No database table or log migration is needed: the numbered plan migration extends the existing JSON payload and revision/history protocol.

## One availability rule

`supportsEquipment` resolves selected item IDs and capabilities. Alternatives are OR; all requirements within one alternative are AND. No requirements means bodyweight, always available. App-owned movement requirements live in the shared exercise inventory. Custom exercises may use exact My Gym IDs in their optional requirements, using the same complete-alternative semantics. The custom editor offers only selected equipment, including individual stations; it does not infer station access from a broad machine type.

The resolver feeds eligibleExercises, Muscle Growth options and day views, Resistance extras, free logging, starter/rebuild choices, configured substitutes, guide equipment details and conditioning alternatives. Future Recommended Resistance Training (#157) must use these same eligibility functions. Avoid/caution, muscle mappings, recovery and recorded load accounting remain authoritative and unchanged.

An equipment edit never rewrites a session, dose, schedule or recorded log. Incompatible scheduled activities remain visible for review and historical correction, with an equipment-unavailable marker. They are excluded from new selectable extras and recommendations. Existing prescribed rows can still record what actually happened; availability is not a reason to delete or falsify history. Muscle Growth retains its configured prescription even when unavailable choices are not offered; previous logs still appear on their dates.

## Persistence, import and undo

Each selection uses the existing validated atomic configuration revision and history service. Group actions are one change. Undo restores the most recent full configuration revision and cannot overwrite later changes. My Gym and imported configuration share strict catalogue-ID/type validation, preview, export/import, backup and undo. Equipment-review notices are separate from the change count, so reapplying an identical update remains Nothing to apply. Neither kilograms nor slabs are inferred from equipment labels.

## Offline images and completeness

All 75 equipment/station diagrams are app-owned SVG source files under assets/equipment, generated and bundled as XML by scripts/build-gym-art.cjs and rendered by the shared EquipmentImage component. These diagrams depict the named gear rather than using unrelated portraits. The same image serves a fixed thumbnail and a larger detail view, with accessible names and no network dependency or layout shift.

All 31 bundled movements, including every starter preset, have correct start/end hero artwork for male, female and neutral profiles: 189 static JPEG phases in the existing hero manifest/require registry. All 13 exceptions from #153 are resolved; illustrationExceptions.json is empty. Existing hero assets and swipeable guides are reused. New guides use the established character references, charcoal/orange art direction and explicit motion cues. Arbitrary user-created movements keep an explicit missing-art state until accurate artwork is provided; they never receive an unrelated generic pose. No image-less app-owned catalogue entry may ship.

Image coverage, source/registry drift, complete equipment alternatives, station isolation, bodyweight behavior, legacy metadata, validation, persistence/undo, shared filtering, history preservation, native rendering and the mobile journey are tested. Native iOS/Android exports verify offline bundling; physical-device checks remain manual per contract 05.
