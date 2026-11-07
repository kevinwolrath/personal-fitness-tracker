# Hero Forge — corrected artwork approval, revision 2

**Visual approval only. Stop here pending explicit owner approval.**

Open [index.html](index.html) for the updated interactive tool. It retains the existing screen previews and offers character/muscle selection, direct front/rear views, isolated highlighting, all four treatments, a numbered mapping sheet, all 14 isolated groups for each character, six before/after comparisons and twelve close-up comparison panels.

## What changed

- Six genuine OpenAI `image_gen.imagegen` reference-image edits using the exact original character sheet from issue #75's ZIP. The successful male proof of concept was also used to refine the male front; corrected front images supported their corresponding rear edits. Prompts and source output paths are recorded in [generation-provenance.json](generation-provenance.json).
- Male front has level, symmetrical pectorals and a straight-on head/torso/pelvis. Female rear now faces directly away, showing no cheek or nose. All characters have level shoulders and balanced poses with full feet. Distinct original identities, hairstyles, builds, charcoal/orange armour and illustration treatment remain the constraints; the generated details still require visual approval.
- Forge scene backgrounds removed through AI editing. Corrected images use charcoal backgrounds. No original approved files were replaced.
- All six final PNGs share a 1024 × 1536 canvas. After the AI pose edits, **uniform** resampling/translation of roughly 0.4–3.2% aligns the bright character bounds to y40–1472 and a common horizontal centre. This does not rotate, mirror, stretch or correct perspective. Raw tool outputs remain unchanged under `artwork/raw/`; [framing.json](artwork/framing.json) records the exact transforms. All paths use the same final pixel coordinates as the normalized PNGs.
- Previous atlas polygons were discarded. New cubic curves are independently defined per character/view in [contours.cjs](contours.cjs), following visible armour/muscle contours. Separate left/right pectoral, deltoid, glute, thigh and limb shapes; rear-only groups remain absent from front views. Female upper-back paths avoid the ponytail. Deep hip flexors remain explicitly a schematic surface projection.
- Priority uses a warm outline; activation uses cyan fill; soreness diagonal hatching; injury cross-hatching. State names accompany colour. Selectors support keyboard use, and demo regions can be selected by click or Enter/Space. This preview records no exercise, symptom or personal data.

## Files to review

- [Six-view contact sheet](contact-sheet-v2.png)
- [14-region mapping sheet](mapping-sheet-v2.png)
- [Isolated highlighting demonstration](highlight-demo-v2.png)
- [Male pectoral close-up](closeup-male-chest.png)
- [Corrected female rear comparison](before-after-female-back.png)
- [Male isolated atlas](isolated-regions-male.png), [female](isolated-regions-female.png), [gender-neutral](isolated-regions-neutral.png)
- Corrected PNGs: [male front](artwork/male-front.png), [male rear](artwork/male-back.png), [female front](artwork/female-front.png), [female rear](artwork/female-back.png), [neutral front](artwork/neutral-front.png), [neutral rear](artwork/neutral-back.png)
- Six separate `overlays/*-regions.svg` definitions and [region data](overlays/muscle-regions.json); [artwork bindings](overlays/artwork-bindings.json) pin each definition to its exact PNG SHA-256. Original `assets/hero-forge/characters` crops/overlays are historical revision 1, not the current preview inputs.

The interactive page contains the full before/after and close-up sets. Screen mock-up buttons continue to be design samples; the character/muscle controls are interactive. Previous proof-of-concept files and unsuffixed historical screenshots remain for comparison. Current revision captures have the `-v2` suffix where applicable.

## Validation

- TypeScript typecheck: passed.
- Existing exercise coverage/state/inventory, prescription exercises and Progress report unit tests: **5 suites / 82 tests passed**.
- Preview checks: exact 14 inventory IDs for all three characters, applicable front/rear visibility, all six PNG dimensions and SHA-256 bindings, **168** character/muscle/treatment combinations, keyboard region selection, distinct sore/injured pattern definitions, all referenced images loaded, no browser exceptions.
- **126** image/overlay screen-matrix checks (three characters × 14 groups × 360/390/430 px): passed, with no page/phone horizontal overflow. Image and paths share one SVG coordinate system and proportional resizing. Mobile chest and upper-back screenshots are included for each width/character.
- Sampled geometric intersection diagnostic at 512 × 768: no cross-group fill intersections detected in any of the six views. Dark-background flood-fill diagnostics can misclassify connected dark armour as background; flagged female lat/glute and neutral abdominal samples were reviewed on the rendered figures rather than treated as anatomical test results. See [contour-diagnostics.json](contour-diagnostics.json).
- Manually inspected the six-view and numbered sheets, all three isolated atlases, original/corrected comparisons, and pectoral/shoulder/upper-back/hip close-ups. Curves follow the rendered figures rather than floating atlas rectangles. This is a visual review assessment, **not proof of anatomical accuracy**. Armour conceals some anatomy; final boundaries and preservation quality need owner review.

No production code, navigation, inventory IDs, exercise/recovery logic, accounts or gamification changed. No merge or deployment performed. Native integration and production theme implementation remain gated and untested in this artwork-only revision.

## Reproduce

Using existing repository dependencies (no additions):

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH='C:\Users\kevin\AppData\Local\ms-playwright'
node docs/design/hero-forge-preview/normalize-artwork.cjs
node scripts/build-hero-forge-preview.cjs
node docs/design/hero-forge-preview/check-contours.cjs
node scripts/review-hero-forge-preview.cjs
```

Generation itself is genuine AI reference editing; these scripts only normalize framing, render the existing PNGs with new SVG paths, and capture/check the approval page. To regenerate the artwork, use the saved prompts and exact reference files with the image-generation tool.
