# 17 · Approved branding and application icons (#106)

The supplied ZIP provides the exact approved three-hero promotional master, female-only launcher master and its supplied 1024px resample. Preserve all three byte-for-byte under `assets/branding/`; hashes are recorded in `manifest.json`. Do not regenerate characters, costumes or lettering. Deterministic derivatives live under `generated/`, reproducible with `npm run branding:build` (Python/Pillow).

The approved female-only image is the launcher/store icon. Launcher derivatives replace only connected near-black exterior corners with the intentional purple background. Android adaptive foreground is padded to 64% of its 108dp canvas with a feathered exterior; head and chest emblem stay within the safe area. The themed monochrome icon is a source-traced female bust/ponytail silhouette with the approved emblem knocked out. Notifications use a separate white-alpha extraction of that emblem, with disconnected outline fragments removed.

The three-hero composition is used for native splash, transient loading, store feature graphic and website/promotional exports. Preserve the entire composition and lettering with contain/padding. Black splash/loading background matches its outer pixels; no white Expo placeholder. Launcher/adaptive backgrounds use deep purple. Functional screens retain their selected theme.

Startup is transient content: approved art, accessible progress indication, no controls or artificial delay. Hold native splash in module scope and dismiss it when storage resolves to tracking, onboarding or an error. Splash API failure must not block these states. Shell, tabs, Plan access, touch targets and vertical budget stay unchanged. Retain appropriate standard menu, calendar, progress, disclosure and action icons. Existing content illustrations are not redesigned.

`app.json` maps launcher, adaptive foreground/background/monochrome, notification icon/color, iOS icon, light/dark splash and favicon to generated assets. Keep package IDs, signing, scheme, storage/export identifiers and Health Connect permission scope. Native projects remain generated, not committed.

Store preparation reads validated derivatives through `scripts/branding.cjs`; it must not restore the old anvil crop or old hero composition. Master/derivative checksum mismatches fail preparation. Store icon stays 512×512 RGBA ≤1 MiB; feature graphic stays 1024×500 RGB. Publishing gates remain unchanged.

Validate source hashes, dimensions/color modes, generated density resources, adaptive XML, notification metadata, splash theme, actual Expo iOS icon generation, startup success/onboarding/error, favicon and functional navigation. Label resource/mask previews accurately. Emulator use remains stopped at the owner's request; installed launcher/splash and iOS-device verification must be reported as limitations until performed.
