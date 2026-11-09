# Issue #106 · Approved branding and icon audit

Started 9 November 2026 on `claude/issue-106-approved-branding`, from latest `develop` (`7c42725`). This is discovery, not a completed branding implementation.

## Required source files

**Resolved:** the owner subsequently supplied `body-anvil-issue-106-assets.zip`. The original files are now preserved under `assets/branding/`, with hashes in its manifest. The missing-source findings below describe the initial audit, not the current implementation state.

Neither exact approved binary is present in the repository, available attachments, local image-generation outputs, or matching filenames in the user's normal image/download folders:

1. Three-hero promotional/splash master, required at `assets/branding/body-anvil-approved-heroes.png`.
2. Female-only launcher master, named in the issue as `a_bold_high_contrast_comic_vector_illustration_a.png`.

The issue explicitly requires the original PNGs and forbids recreating or silently substituting them. Existing orange/charcoal hero illustrations and the old anvil icon are not either approved master. No replacement artwork was generated, no source was fabricated and production configuration remains unchanged. Implementation can proceed directly when the exact files are supplied; no mock-up approval gate is needed.

## Findings

| Surface | Current evidence | Required work |
|---|---|---|
| Expo/global launcher | `app.json` points at `store/google-play/en-US/images/icon.png`, a 512×512 RGBA anvil-only export. | Derive platform-specific launcher exports from the female-only source; preserve the original. |
| Android legacy launcher | Cached native resources contain `mipmap-mdpi/ic_launcher.webp` at 48×48, using the old anvil. Manifest references `@mipmap/ic_launcher`. | Replace density exports through Expo configuration/prebuild; inspect small-size legibility. |
| Adaptive foreground/background | No explicit `android.adaptiveIcon` configuration. Generated foreground is 108×108; `iconBackground` is white. No adaptive XML appeared in the inspected generated resource inventory. | Configure approved foreground, intentional background and monochrome asset; verify circle/squircle/rounded-square masks and safe zone. Do not assume the old generated foreground establishes a working adaptive icon. |
| Android splash/startup | Generated `splashscreen_logo.png` is a 288×288 Expo placeholder construction-grid image. `splashscreen_background` is `#FFFFFF`; launch theme uses `ic_launcher_background`, a centered bitmap layer over that color. | Replace actual placeholder resources with the approved three-hero source, using explicit splash configuration and appropriate contain/padding. Preserve hero composition and lettering. |
| Android task switcher | Main application/activity use the same launcher and app theme. | Verify inherited icon and startup/task presentation after regeneration; keep package ID and label. |
| Notification small icon | `expo-notifications` has no configured icon/color in `app.json`; generated main manifest has no custom notification-icon metadata. `src/platform/notifications.ts` schedules content without an icon override. | Supply a dedicated, legible white-alpha notification glyph derived from the approved direction, rather than feeding a detailed opaque launcher image into the small-icon slot. Verify generated resources/metadata. |
| iOS | Global Expo icon currently points to the same anvil export; no iOS-specific icon or splash assets configured. An actual iOS native asset catalog has not been generated/inspected in this audit. | Prepare appropriate opaque icon/catalog inputs and splash derivatives from originals; inspect generated catalog. Windows cannot provide an installed iOS-device verification. |
| Store icon | `store/google-play/en-US/images/icon.png` is 512×512 RGBA. | Replace with an approved female-only derivative within the existing size/file limits. |
| Store feature graphic | Current 1024×500 RGB PNG composes the existing male/female/neutral orange heroes. | Use the exact approved three-hero promotional artwork; preserve source and derive non-destructively. |
| Store regeneration | `scripts/prepare-play-listing.cjs` explicitly redraws the old anvil crop and recomposes old hero artwork (roughly lines 155–175). Manifest/README record those old sources. | Update generation and provenance together so `store:prepare` cannot overwrite the new identity with obsolete art. Keep validation, package identity and publishing boundaries intact. |
| Web/favicon/promotional consumers | No explicit favicon is configured. No separate deployed marketing website is present in this repository. | Prepare explicit favicon and reusable promotional exports; do not invent or deploy a website outside this repository's scope. |
| App menu | `AppShell.tsx` draws a standard three-line menu in theme tokens, with a labeled pressable. Header brand is text. | Retain appropriate functional menu icon and header geometry. No new shell controls or vertical-budget increase planned. |
| Tabs | `TabBar.tsx` uses theme-colored SVG calendar and progress-trend icons with tab labels/selected semantics. | Retain these appropriate functional icons. |
| Daily Log/actions | Text glyphs for share, disclosure, information, completion and undo are paired with existing accessible controls. Meal/photo flows use camera, gallery and lock symbols. | Check appearance/contrast across platforms and replace only demonstrably inconsistent or illegible glyphs; preserve labels, roles and hit targets. No arbitrary replacement of standard icons. |
| Empty/loading states | `NoPlanCard.tsx` uses text and a labeled action; `AppProvider.tsx` uses a theme-colored native activity indicator. | No obsolete raster brand icon in these components. Keep their tracking/loading behavior. Brand startup belongs to the actual splash resources. |
| Exercise illustrations | Existing hero/exercise artwork is content, not launcher or toolbar iconography. | Preserve existing approved illustrations and tracking behavior; no implied costume/character redesign. |

## Native resource provenance

The resource inspection used the already-built local Android image, **without launching or operating an emulator**. Its `app.json` SHA-256 equals the current checkout's: `0c26b9561579b7d0540f296827e68f275fe8e05ddde0178098916edd3db4e48e`.

Relevant inspected paths inside that image:

- `/app/android/app/src/main/AndroidManifest.xml`
- `/app/android/app/src/main/res/values/colors.xml`
- `/app/android/app/src/main/res/values/styles.xml`
- `/app/android/app/src/main/res/drawable/ic_launcher_background.xml`
- `/app/android/app/src/main/res/mipmap-mdpi/ic_launcher.webp`
- `/app/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.webp`
- `/app/android/app/src/main/res/drawable-mdpi/splashscreen_logo.png`

The generated splash placeholder and white background are directly confirmed. An installed launcher's masking/white-circle behavior is not claimed as verified by reading resources.

## Implementation and validation sequence once sources arrive

1. Inspect both originals, retain bytes unchanged under `assets/branding/`, record source dimensions and SHA-256 hashes.
2. Derive launcher/adaptive/monochrome/notification/iOS/web/store exports into separate generated paths; never overwrite masters. Use deterministic resizing/masking/composition rather than regenerating characters or lettering.
3. Update Expo and store-generation configuration together, including provenance and validators, so regeneration consistently uses approved masters.
4. Check source hashes remain unchanged; verify dimensions, alpha/opacity requirements, contrast, adaptive safe zone and 48dp legibility. Inspect generated Android/iOS resources and package/signing/Health Connect declarations.
5. Capture before/after startup and any changed functional-icon screens; run applicable Playwright, typecheck, unit/native export/build checks. Existing navigation and content vertical budgets remain unchanged.

Emulator checks remain stopped at the owner's request. No emulator was used for this audit, and installed launcher/splash acceptance screenshots have not been captured.
