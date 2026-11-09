# #106 · Approved branding implementation

The original three-hero and female-only PNGs are now preserved unchanged in [assets/branding](../../../assets/branding/README.md). The female artwork supplies launcher/store/favicons; the three-hero artwork supplies splash/loading and promotional exports. No replacement artwork was generated.

The old anvil-only launcher, white Expo placeholder splash and old store-regeneration sources are replaced. Adaptive foreground/background/monochrome and notification small icons are explicit. Startup has no added delay and hands off to tracking, first-run setup or the error state. Package ID, signing key, scheme and Health Connect permissions remain intact.

## Evidence

- [Source/export manifest](../../../assets/branding/manifest.json) and [branding contract](../../design-contracts/17-branding.md).
- [Export overview](export-preview.jpg).
- [48px circle/squircle/rounded-square previews](mask-preview-48px.png), including the themed female silhouette.
- [Before/after generated splash resources](splash-resource-before-after.jpg).
- [Generated native resource inspection](resource-report.json): 25 Android density resources, transparent foreground/monochrome, white-alpha notification glyphs, both adaptive icon XML files, dark backgrounds and actual Expo-generated 1024px opaque iOS icon/catalog.
- [Retained functional icons at 390px](functional-icons-390.jpg); [Today](390-today.png) and [Progress](390-progress.png). Equivalent screenshots are included for 360 and 430px.
- [Initial audit](AUDIT.md), with its missing-source blocker explicitly marked resolved.

All resource/mask previews are labeled as such. **They are not installed-device screenshots. No emulator was used for #106**, respecting the owner's stop instruction. Installed launcher/splash, live task-switcher/notification appearance and an installed iOS startup remain unverified. The iOS icon was generated with Expo's actual `generateUniversalIconAsync`, not an Xcode build on this Windows host.

The full 390px screens and all refreshed baseline comparisons were visually inspected. Standard menu/calendar/progress/disclosure/action icons remain appropriate and accessible; no shell/header controls moved. Baseline refresh also catches pre-existing develop workout/measurement changes, not extra branding-driven layout changes.

## Validation · 9 November 2026

| Check | Result |
|---|---|
| TypeScript | PASS |
| Full Jest: scripts/unit/iOS/Android | PASS · 73 suites, 870 tests |
| Complete Playwright at 360/390/430px | PASS · 486 tests, 108 expected visual/viewport-specific skips |
| Dev-server smoke | PASS · 1 test |
| Source and derivative integrity | PASS · masters match archive hashes; tampering/stale exports rejected |
| Source regeneration | PASS · deterministic Pillow exports; original bytes unchanged |
| Generated native resource audit | PASS · 25 Android density resources, normal/round adaptive XML, notification alpha/color, iOS opaque catalog |
| Android/iOS JavaScript exports | PASS |
| Local Android release APK | PASS · 468 Gradle tasks; embedded bundle verified; no emulator launched |
| Store preparation and dry-run validation | PASS · six local images; no publishing/API commit |
| Dependency agent-file guard | PASS |
| Patch whitespace | PASS |

The repository has no ESLint/npm lint command. Android release lint ran in the successful local build. The previous and current native project's local test signing-key SHA-256 match (`221e0a3106aa4c3ccc154e0a418b55020b3f9ea6e84f92e8749cd9e2f39f5e58`). The compiled APK reports `com.questspire.personalfitnesstracker`, version 0.1.0/code 1, min SDK 26/target 36; its actual adaptive XML contains background, foreground and monochrome layers. APK SHA-256: `47b46d22d508d2bc7ab239c00e9ff017ebbde685fbf53f3218c02ec6258b9a80`.

Final loading status-bar contrast is explicitly light on black, including while the Classic theme is selected; the seven focused configuration/startup tests were rerun successfully after that refinement.

Startup native tests cover pending storage with accessible approved artwork, successful tracking handoff, first-run setup and storage failure without a stuck splash. Browser tests check favicon delivery and retained accessible menu/tab navigation. Existing tracking and Health Connect suites pass.

## Reproduce

```powershell
npm run branding:build
npm run typecheck
npm test -- --runInBand --cacheDirectory .expo/jest --testTimeout=30000
npm run export:web
node scripts/prepare-play-listing.cjs
npm run store:validate
$env:PFT_E2E_PORT='8196'
npm run test:e2e -- --workers=4 --timeout=120000 --update-snapshots=all
$env:E2E_DEV='1'
$env:PFT_E2E_PORT='8197'
npx playwright test --timeout=180000
```

Native prebuild and the local APK build use the repository's Expo/Docker workflow; generated `android/` stays ignored. The app's public marketing website is not in this repository, so reusable website artwork is prepared rather than deploying or editing an unrelated site. Nothing was published to Play or merged automatically.
