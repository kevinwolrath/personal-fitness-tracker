# Hero Forge visual identity · issue #96

**Design approval stage only. Production UI is unchanged.**

The owner’s [issue #96](https://github.com/kevinwolrath/personal-fitness-tracker/issues/96) requires an audit, five mobile mockups and an icon sheet, followed by explicit visual approval **before broad app implementation**. This package stops at that gate. It does not complete or close the issue.

## Review the two directions

| Direction | Overview | Treatment |
|---|---|---|
| **A · Forged panels (recommended)** | [Five screens](screenshots/forged-overview.png) | Asymmetric panel corners, metallic edges, restrained orange action surfaces and inset edge details. Closest to the reference screen’s armour panels. |
| **B · Armour rails** | [Five screens](screenshots/rails-overview.png) | Open-sided surfaces, thicker grey side rails, square action plates and diamond selection marks. More industrial; less enclosing chrome. |

[Original 28-icon family](screenshots/icon-family.png) · [App-wide audit](audit.md) · [Implementation specification after approval](implementation.md)

| Surface | Current app | A | B |
|---|---|---|---|
| Today | [Before](screenshots/current-today.png) | [390 px](screenshots/forged-today.png) | [390 px](screenshots/rails-today.png) |
| Progress | [Before](screenshots/current-progress.png) | [390 px](screenshots/forged-progress.png) | [390 px](screenshots/rails-progress.png) |
| Today’s Workout | [Before](screenshots/current-workout.png) | [390 px](screenshots/forged-workout.png) | [390 px](screenshots/rails-workout.png) |
| Exercise guide | [Before](screenshots/current-guide.png) | [390 px](screenshots/forged-guide.png) | [390 px](screenshots/rails-guide.png) |
| Settings | [Before](screenshots/current-settings.png) | [390 px](screenshots/forged-settings.png) | [390 px](screenshots/rails-settings.png) |

The gallery in [index.html](index.html) shows both options via `?direction=forged` or `?direction=rails`; `?screen=icons` shows the icon sheet. Buttons are **static visual representations** of existing application actions. They do not log data or operate the application. Gallery navigation links work. This is not an implemented app theme.

## Reference comparison

All three approved reference images were examined: [mobile screens](../../../assets/hero-forge/references/hero-forge-mobile-screens.png), [three character sets](../../../assets/hero-forge/references/character-front-back-options.png), [muscle-map reference](../../../assets/hero-forge/references/hero-forge-character-muscle-map-reference.png). The [original ZIP manifest](../../../assets/hero-forge/references/manifest.json) records the issue-comment attachment URL and hashes.

Both proposals retain the charcoal background, grey metal surfaces, orange emphasis and existing black/orange heroes. A follows the enclosed metallic panels in the approved mobile reference; B draws from the side rails in the muscle-map reference. The wordmark is system-font text with a new small anvil glyph, rather than a raster crop of the elaborate reference masthead. That proposed simplification needs approval alongside the icons.

Neither copies the reference’s example weight, progress, statistics or achievement-like decoration. The Today header remains compact; no large banner, extra tab or hero portrait pushes its primary content down. Existing sheet presentation remains a 92% panel with a fixed Close header. The workout figures use the **existing female profile artwork** shown by this seed-plan fixture; the exercise guide retains its **editorially assigned male hero**, independently of profile.

## Evidence and limits

- Current-state captures use the unchanged production web export, bundled `plans/seed.plan.json`, an empty tracking store and fixed time **2 November 2026, 09:00 AEDT**. This is an isolated audit fixture, not the owner’s live history. Its 78 kg goal, targets, exercise doses and 12 eligible movements come from that plan/model. No measurements or completions were inserted.
- Proposal screens show the same relevant state: 0/7 activities, 0/12 exercises, no measurements, and the existing Settings energy example. Secondary actions including Skip and more, session options and Show activated muscles remain represented below their existing content.
- Chromium renders at 390 × 844. Automated geometry checks cover both directions × five surfaces × 360/390/430 widths (30 cases): no horizontal page overflow; button targets at least 48 × 48; images load; Today content begins within 200 px and compact workout remains at most 200 px. Chromium’s default scrollbar hiding is disabled; the preview’s CSS hides indicators without disabling content scrolling.
- [render-checks.json](render-checks.json) records measured results. The renderer checks geometry, not aesthetic quality or full app behavior. All five before captures, both complete overview sheets, individual proposal screens and the icon sheet were visually reviewed.
- Native Android/iOS rendering, 200% system text, screen-reader traversal, real safe-area/keyboard behavior, Classic-theme regression and production interactions require verification **after approval and implementation**. These HTML proposals are not native validation. No production visual baselines were refreshed.
- `npm run export:web` passed for the unchanged app. No dependencies, production sources, overlays or approved artwork changed. Broad Jest/E2E/native-build runs are deferred until production code changes; this package makes no claim that they ran or passed for #96.

## Reproduce locally

From the repository root, after installing its existing dependencies:

```powershell
node docs/design/hero-forge-identity/build.cjs
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\kevin\AppData\Local\ms-playwright'
node docs/design/hero-forge-identity/capture.cjs
```

`capture.cjs` temporarily serves repository assets on localhost:8096 and closes its server/browser on completion. To refresh before captures, first `npm run export:web`, then run `capture-current.cjs` (temporary localhost:8097). Neither script changes application source or user storage. SVG files are original local paths emitted from `icons.cjs`, with no third-party icon package or runtime network dependency.

**Approval requested:** choose A or B, approve/revise the icon family and compact anvil/wordmark, and identify any surface changes. Until that owner response, production implementation and merging remain paused at the issue’s visual checkpoint.
