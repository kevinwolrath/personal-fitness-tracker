# Body Anvil Google Play listing (#100)

The versioned package is `store/google-play/`. It preserves Android package
`com.questspire.personalfitnesstracker`, upload signing and installed app data.
It does not change the Expo launcher icon or configure a new keystore. `app.json`
currently has no custom launcher icon: that is separate from the Play listing icon.

## Prepare and validate locally

Use Node 22 (the CI version) or a compatible newer Node and the locked dependencies:

```sh
npm ci --no-audit --no-fund
npm run listing:validate
npm run listing:publish
npx jest --selectProjects scripts --runInBand
```

`listing:publish` defaults to **dry-run**: validates local files, prints an asset
inventory with SHA-256 hashes, reads no credentials and makes no network requests.
The manifest explicitly lists each locale, text file convention and image order.
The script decodes PNGs, checks CRCs, size/opacity/dimensions, distinct screenshots,
text limits, package identity and completeness; missing required files fail.
Only PNG is supported by this package, even where Play also accepts JPEG.

To regenerate imagery, install Playwright's Chromium (`npx playwright install chromium`),
export the web app and serve it with the repository's existing server:

```sh
npm run export:web
node scripts/serve-dist.mjs
```

In another terminal at the repository root:

```sh
npm run listing:prepare -- --graphics --screenshots
npm run listing:validate
```

Either generation flag can be used alone. `--graphics` renders the authored anvil
mark and wordmark in the existing Hero Forge charcoal/ember palette from
`src/ui/theme.ts`. These are proposed store graphics for review, not a claim that
an existing launcher icon was approved. `--screenshots` captures the actual running
web app at 390×780 CSS pixels, scale 3 (1170×2340), using only the generic example
plan, the explicitly labelled `demo-observations.json` fixture (stable sample measurements, not promised results), and a fixed demonstration date. No private bundled plan, API call or fabricated
screen is used. Inspect all three screenshots after regeneration. They show the web
rendering of Daily Log, Progress and Muscle Coverage; they do not demonstrate
native-only Health Connect or notification behaviour. Capture Android device images
instead if Play review or your final listing requires native screenshots. Do not
stretch, composite or relabel a web capture as an Android device capture.

`PFT_LISTING_URL` can select another loopback HTTP port.
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium installation.
The capture script waits for app readiness and fails on uncaught page errors.
No tablet images are supplied because no genuine tablet captures have been prepared.

## Asset and text rules

| Item | Play requirement / package policy |
| --- | --- |
| Title | 1–30 characters; Body Anvil, no promotional ranking or pricing claims |
| Short description | 1–80 characters |
| Full description | 1–4000 characters; accurate features, no keyword stuffing |
| Release notes | At most 500 characters per language; attached only when uploading an AAB |
| High-resolution icon | Exactly 512×512; 32-bit PNG accepted by Play; max 1024 KiB; this package requires fully opaque 32-bit RGBA PNG, no baked-in rounded mask |
| Feature graphic | Exactly 1024×500; JPEG or 24-bit PNG without alpha accepted by Play; this package requires opaque 24-bit RGB PNG, under 8 MiB |
| Phone screenshots | 2–8; JPEG or 24-bit PNG without alpha accepted by Play; 320–3840 px on either side, longest at most twice shortest; this package requires distinct opaque 24-bit RGB PNGs under 8 MiB |
| Tablet screenshots | Optional per device category, up to 8; add only real tablet captures through an explicit manifest/validator change |

The 1170×2340 captures meet the 2:1 maximum. Promotional placement can have stricter
recommendations (for example four 1080px portrait screenshots); this package makes
no promise of promotional eligibility. Keep typography and important graphic
content away from cropping boundaries; avoid store badges, unearned awards,
medical claims, device frames that imply unsupported behaviour or extra UI overlays.

Play references (check current Console guidance before final submission):
[listing text](https://support.google.com/googleplay/android-developer/answer/9859152),
[preview assets](https://support.google.com/googleplay/android-developer/answer/9866151),
[Edits API](https://developers.google.com/android-publisher/edits),
[image upload](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.images/upload).
Local validation cannot replace Play policy or editorial review.

## Locales

`en-AU` is the sole baseline. Set the Console app's default language to English
(Australia) once. The API listing update does not change the app default language.
Play chooses its normal fallback for untranslated users; we do not silently upload
`en-US`. Only add `en-US` to `manifest.locales` if the app's actual Play configuration
requires it; copy/review all four text files and required images into that directory.
Validation then requires the complete locale. Do not assume changing the JSON changes
Console configuration or an already published default language.

## Publish deliberately

The existing `.github/workflows/google-play-internal.yml` remains the signed Android
build/internal-release pipeline. The new **Prepare Google Play listing** workflow
never builds Android: listing-only changes need neither a keystore nor a build.
It shares the existing publisher's concurrency group so Play edits do not race.
Both jobs run only on the dedicated Windows self-hosted runner on `.45`.

Run **Actions → Prepare Google Play listing → Run workflow** on a reviewed branch:

- `mode=dry-run` (default): local checks only; no Play secret is exposed to this step.
- `mode=validate-only`: upload into a temporary edit, call Play validation and delete
  the edit. This makes API requests but does not commit listing or release changes.
- `mode=commit`: validate, then commit with `changesNotSentForReview=true`. There is
  no fallback to automatic submission if Play rejects that flag. Review and submit
  changes manually in Console. Managed publishing settings still need owner review.
- `track=internal` (default), `alpha`, `beta` or `production`: controls the optional
  AAB's destination. A listing itself is shared across tracks; choosing internal
  does **not** make listing text track-private.
- Optional `aab_path` and `version_code`: an existing signed AAB on the dedicated
  runner and its matching versionCode. The publisher reuses the existing resumable
  upload transport, checks the server's versionCode and creates only a **draft**
  release with localized notes. Existing served releases and rollouts are preserved; an existing draft blocks another upload rather than being overwritten. No automatic binary rollout, on any track.

The existing build pipeline is not duplicated. To obtain an AAB without immediately
releasing it, the same `docker/android-play.Dockerfile` and
`scripts/google-play-release.sh` support `AAB_OUTPUT_DIR`: mount a dedicated output
directory there and set that variable in the container. After the existing signing
checks and Gradle build, it copies `app-release.aab` there and exits **before upload**.
Use the existing upload key, version-code resolver and secret mounts documented in
[the build guide](google-play-deploy.md). An already uploaded versionCode cannot be
uploaded again; omit the AAB for listing-only updates. Delete retained AABs according
to your runner retention policy. No AAB or credential is uploaded as a GitHub artifact.

For a local credentialed operation, keep service-account JSON outside the checkout,
set `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` to that path, then run, for example:

```sh
node scripts/publish-play-listing.cjs --mode validate-only --track internal
node scripts/publish-play-listing.cjs --mode validate-only --track internal --aab /absolute/path/app-release.aab --version-code 42
```

The workflow uses the existing `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` repository or
GitHub environment secret. No credential values are committed or printed. Give the
service account only access to this app, listing management and the testing tracks
actually used. A production service account, if needed, belongs in the protected
production environment and needs the corresponding app permission. GitHub token
permissions are `contents: read`; checkout does not persist credentials.

### Production gate (required before production use)

Create GitHub environment **google-play-production** with required reviewers and
**prevent self-review**. Restrict deployments to reviewed release branches. Put
production-capable Play credentials only in that environment; keep the repository
credential restricted to testing. Production API modes require the explicit
`approve_production` dispatch input and approval of the environment job. A guard
queries GitHub to confirm required reviewers and prevent-self-review are configured;
unreadable configuration or unsupported protection fails closed. If your repository
plan cannot provide environment protection, do not use the production API path.
Local production commits also require `PLAY_PRODUCTION_APPROVED=production`; that
is an explicit operator acknowledgement, not a substitute for the workflow gate.
The workflow never sends changes for review or rolls out a production binary.
Final submission/rollout remains a separate, explicit Play Console action.

## One-time owner setup still required

1. Register or select the existing Body Anvil Play app. Preserve its exact package
   and existing signing identity. Confirm the default language and developer contact
   details. Do not create a second identity to get around a Console error.
2. Enable Google Play Android Developer API in the service account's Cloud project.
   Grant the service account access to this app in Play Console with the minimum
   listing and testing release permissions. Store its JSON securely in the existing
   Actions secret; never put it into issue comments or logs.
3. Confirm Play App Signing and the registered upload certificate. Preserve the
   upload keystore and its existing secret names from the build guide.
4. Complete all Console policy declarations: app access, ads, target audience,
   content rating, health-app/Health Connect permissions and testing eligibility.
   Account-specific closed testing requirements and production access are manual.
5. Supply a real, public privacy-policy URL and developer contacts. Review actual
   data flows, including optional Anthropic screenshot processing, and answer Data
   safety accurately. This PR deliberately supplies no invented legal declaration,
   privacy URL or medical certification. The current in-app privacy/rationale links
   and app content must match what the owner declares.
6. Configure the GitHub environments and reviewer protection above. Review all text,
   the proposed icon/feature graphic and every screenshot. Configure managed publishing
   and any Console approval/review steps appropriate for the app.
7. Run offline validation, then credentialed `validate-only`, then an approved
   internal commit. Inspect Pending changes and the draft release in Console before
   submitting or rolling out. A brand new draft app may require its first binary
   upload and initial declarations through Console before API edits are accepted.

These administrative/credentialed steps are not established by local fake-API tests.
No Play credentials, Console access, runner access or live upload were used to build
this package. The workflow itself must be exercised on `.45` after secrets and
permissions are configured. Production rollout is not part of this ticket's execution.

## Failure and recovery

On a failed API operation, the script deletes its unfinished edit and exits nonzero.
If cleanup fails, it names the edit so the operator can remove it or wait for expiry.
Never retry a commit blindly after a network timeout: check Console first because
Google might have committed it. Image replacement happens inside one edit; local
asset order is deterministic and a successful commit replaces only the three
managed image categories for each declared locale. Other locales/assets are untouched.
Do not edit the same app manually while a publishing job owns an edit. A concurrency
lock covers these two workflows, not Console users or external uploaders.

For 401/403 verify API enablement, service account app access and listing/release
permissions. For policy/default-locale/draft-app errors finish the Console prerequisite
rather than weakening validation. Restore previous text/images by reviewing a prior
Git revision and creating a new deliberate edit; app binaries cannot reuse an already
used versionCode. Validate-only uploads may consume version codes; choose the next
unused version using the existing resolver. Re-run signing/build only when a new
binary is needed. Tests cover malformed/transparent/wrong-size images, missing
manifest files, text limits, dry-run isolation, API request routing and edit cleanup.
