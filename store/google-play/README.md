# Body Anvil · Google Play listing bundle

Versioned `en-US` package for **`com.questspire.personalfitnesstracker`**, targeting the existing Google Play default listing. Before authenticated staging, the publisher reads app details and listings and requires both defaultLanguage=en-US and an existing en-US listing. Every mode refuses a missing/mismatched default; no mode creates a locale or changes the default language. Other translations remain untouched. All ten migrated files, including all six approved graphics/screenshots, retain their original bytes.

## Contents and validation

| File / group | Format and limits | This package |
|---|---|---|
| `title.txt` | Plain UTF-8, 1–30 characters | Body Anvil |
| `short-description.txt` | Plain UTF-8, 1–80 characters | Existing capabilities only |
| `full-description.txt` | Plain UTF-8, 1–4,000 characters | No rankings, guarantees, fabricated metrics or legal/privacy assertions |
| `release-notes.txt` | Plain UTF-8, ≤500 characters per locale | Attached only when an AAB draft is supplied; review for each release |
| `images/icon.png` | 512×512, 32-bit RGBA PNG, ≤1,024 KiB | Existing approved anvil emblem crop, on charcoal; also configured as Expo’s launcher icon |
| `images/feature-graphic.png` | 1024×500, JPEG or 24-bit RGB PNG without alpha | RGB PNG, layout using the three unchanged canonical heroes |
| `images/phone/*.png` | 2–8 per phone category; JPEG or 24-bit RGB PNG without alpha; each side 320–3840 px, longest ≤2× shortest | Four 1170×2340 RGB PNGs, captured at 390×780 CSS px ×3 |

The project deliberately accepts only PNG for its versioned bundle, caps each graphic at 8 MiB, and rejects unreviewed device categories. The validator reads PNG signatures/chunks and inflates image data, checks dimensions/colour type, manifest hashes, sources/alt descriptions, unique paths/counts and locale/package identity. It rejects placeholders and unmanifested images. It is not a legal/content-policy approval tool.

Google’s **recommendation eligibility** guidance additionally asks for four screenshots at least 1080 px in 9:16 portrait or 16:9 landscape. The current honest 1:2 captures meet the basic upload limits, **not that additional 9:16 recommendation condition**. Do not stretch or crop UI to claim eligibility. Tablet screenshots are omitted because this is a portrait phone app, not a genuine tablet UI.

Sources, checked 8 November 2026: [Play preview asset specifications](https://support.google.com/googleplay/android-developer/answer/9866151), [listing text and setup](https://support.google.com/googleplay/android-developer/answer/9859152), [release notes](https://support.google.com/googleplay/android-developer/answer/9859348). Policy can change; recheck before publication.

## Accurate screenshot provenance

`manifest.json` records source commit, capture engine, viewport, source plan, fixed date and checksums. Screenshots show **the real production React Native Web application**, not a proposed #96 design, composited UI or generated phone screen. They use the repository’s seed plan with **empty observations/completions**, at 2 November 2026 09:00 AEDT. The goal, targets and exercises are plan data; the empty Progress screen deliberately has no invented history. No account or owner’s live data is captured. No annotations/device frames are added.

These are web test-surface captures; a human must confirm parity with the signed Android build before publishing. Platform-specific Health Connect or native picker UI is not depicted. No native-Android screenshot claim is made. Review every captured screen, source commit and store copy against the binary being submitted. Existing approved art is reused; no AI generation is performed for #100.

The icon reuses the metallic anvil from `assets/hero-forge/references/hero-forge-character-muscle-map-reference.png`. The feature graphic uses `assets/hero-forge/app/{male,female,neutral}-front.png`. No hero faces, costumes, proportions, poses or muscle overlays change. Expo previously had no explicit launcher icon; setting this local icon removes the default fallback while leaving package ID, scheme, version and signing configuration intact.

## Local operations (no credentials)

```powershell
npm run store:validate
npx jest --selectProjects scripts --runInBand
```

To regenerate the package with installed Playwright Chromium:

```powershell
# Optional when browsers are cached in this Windows location:
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
npm run store:prepare
git diff -- store/google-play
```

`store:prepare` exports the actual app, starts a temporary loopback server, captures it in an isolated browser context, renders the graphic/icon from existing artwork, writes the manifest and validates. The server/browser close on completion. It does not read Play credentials, operate a user’s browser, change tracking storage or publish anything. Existing dependencies only; no fastlane/Ruby or new Node package. Font rasterization can differ between hosts, so review regenerated binaries rather than assuming byte-identical output across OS/browser versions.

## Publishing

See [operations, protection, initial setup and recovery](../../docs/google-play-listing.md). Default `dry-run` makes **zero API calls**. `validate-only` creates/stages/validates/deletes a temporary Play edit; it does require credentials and may upload a bundle to that temporary edit, but does not commit. `commit` is protected, never automatically dispatched, never rolls out a production binary, and requests that changes not be sent for review. **Listing metadata is app-wide and not isolated to an internal testing track.** Review Publishing overview before any subsequent manual submission.
