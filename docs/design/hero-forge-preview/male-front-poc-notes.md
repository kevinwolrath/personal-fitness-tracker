# Male front-view regeneration proof of concept

7 November 2026. Visual approval pending. No full character correction authorized or performed.

- Tool: OpenAI built-in `image_gen.imagegen`, called through `tools.image_gen__imagegen`.
- Reference-image editing: supported and used successfully with `referenced_image_paths` pointing to the exact original PNG extracted from issue #75's reference ZIP. No CLI/API fallback was used. The tool does not expose its underlying model version here.
- Exact reference: `artifacts/hero-forge-reference/extracted/hero-forge-references/character-front-back-options.png`; full source sheet copied alongside this note as `male-front-poc-original-sheet.png` for reproducibility. The target is its leftmost male front figure.
- Generation: one call, one male output. Full prompt saved as `male-front-poc-prompt.txt`.
- Output: `male-front-regenerated-poc.png`, copied unchanged from the image-generation tool output.
- Comparison: `male-front-original-vs-regenerated-poc.png`. Left is the approved source cropped for presentation; right is the AI result. Both use uniform display scaling. Canvas only assembles this comparison; it does not correct the pose. No CSS/SVG transforms, mirroring, stretching or simple image rotation were used to create the correction.

Visual inspection: the new figure has a frontal gaze, square shoulders, front-facing chest/pelvis, balanced stance, both hands and complete feet visible. The same general face/hair, muscular build, graphite segmented armour, orange panels, gloves and black/white/orange footwear are retained. This is not pixel-identical reproduction: AI reinterpreted some facial, muscle, seam, glove and shoe details, and changed the stance. Preservation quality remains for the owner to judge; the result is not approved replacement art.

No approved artwork was overwritten. Female/neutral artwork, muscle overlays and production application code were not modified. Nothing was merged. Stop here and await explicit visual approval.
