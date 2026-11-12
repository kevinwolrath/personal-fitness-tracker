# Google Play internal deployment

The workflow `.github/workflows/google-play-internal.yml` is **manual only** and runs only on the self-hosted Windows `.45` runner. Android tooling, signing and upload run inside Docker. It creates no GitHub Actions artifacts and cannot deploy to production: the container script fixes the track to `internal`. With `build_only=true`, the same pipeline retains its signed AAB on the dedicated runner and exits before uploading. For listing-only or listing-plus-draft updates, see [Google Play listing automation](google-play-listing.md).

## Immutable app identity

- Android package: `com.questspire.personalfitnesstracker`
- Play track: `internal`

## GitHub Actions secrets

Configure these repository Actions secrets:

These are the names the workflow reads (`.github/workflows/google-play-internal.yml`, job `env`):

- `ANDROID_KEYSTORE_BASE64` — base64 of `personal-fitness-tracker-upload.jks`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_UPLOAD_KEY_ALIAS` — `personal-fitness-tracker` (or the alias actually used when the key was generated)
- `ANDROID_UPLOAD_KEY_PASSWORD` — key password
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` — the Google Play service-account JSON key, as plain JSON text
Repository **variable** (Settings → Secrets and variables → Actions → Variables), not a secret:

- `BODY_ANVIL_API_URL`: the site the Body Anvil API runs on, `https://questspirestudios.com`, without `/api/body-anvil/v1` (#146, #155). It's inlined into the app. The workflow and the build refuse a missing or non-https value, or one that includes the API path, and the build checks that the AAB contains it. See [the health sync API](health-sync-api.md#base-url).

Repository secret:

- `BODY_ANVIL_ENROLLMENT_KEY` — the health-sync enrollment key (#136), the same value as the Questspire Studio Worker's production secret. It's inlined into the app's JS bundle, and the build checks that the AAB contains it without printing it. See [the health sync API](health-sync-api.md#enrollment-key-136).

PowerShell example for producing the keystore's base64 value locally (do not commit or paste the output into issues/logs):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\SigningKeys\personal-fitness-tracker-upload.jks')) | Set-Clipboard
```

The workflow decodes these only into a unique directory under `RUNNER_TEMP`, bind-mounts them read-only into the Docker container, and removes the temporary directory in a `finally` block.

## Google Play setup

1. Create the Play Console app with package `com.questspire.personalfitnesstracker` and enable Play App Signing.
2. Create/use a Google Cloud service account for automated Play uploads.
3. Grant that service account access to this app in Play Console with permission sufficient to create/update releases on the **Internal testing** track. Do not grant production permissions merely for this workflow.
4. Download its JSON key once and store its plain JSON in `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, then store/delete the local copy according to your credential-storage practice. Do not base64-encode this secret.
5. Add the upload certificate/key to Play Console when Play setup asks for it. Google owns the Play app-signing key; this repository uses only the upload key.

## Run

GitHub → Actions → **Deploy Android to Google Play Internal** → **Run workflow**.

The job prints the package, fixed `internal` target and versionCode before building. The container then:

1. generates the Android project (`expo prebuild`) and points the **release** build type at the upload key;
2. checks, before the Gradle build, that the applicationId, versionCode and release signing are right (a mismatch fails in seconds);
3. builds the signed AAB with `BODY_ANVIL_API_URL` and `BODY_ANVIL_ENROLLMENT_KEY` inlined, and checks that the bundle carries both (the URL is printed; for the key, only present or absent);
4. uploads it with `scripts/upload-play-bundle.js`: a resumable upload in 8 MiB chunks that, when the connection drops, asks Google how much arrived and continues from there (up to 8 attempts with backoff), then releases it to the internal track and commits.

The release then appears under Play Console → Testing → Internal testing. If the app has never been published, Play only accepts draft releases: the script then creates a **draft** internal release, and the log says so; roll it out in Play Console.

### Build cache on .45

Gradle's downloads and build outputs are kept in the Docker volume `pft-gradle-cache` (mounted as `GRADLE_USER_HOME`), and the image `pft-google-play` is kept between runs so `npm ci` reruns only when `package-lock.json` changes. The first deploy after this change, or after the cache is cleared, takes the old full time; later deploys reuse the cache. The base image is pinned by digest in `docker/android-play.Dockerfile` (and `docker/android.Dockerfile`), so it is never re-pulled; change both to upgrade. The Android SDK parts the build needs (CMake 3.22.1, the NDK, build-tools and platform; the base image ships other versions) are installed into the image once, in a cached layer before `npm ci`, so Gradle never downloads them during a build (#160: two parallel CMake downloads raced and broke a deploy). When React Native's NDK, build-tools or compile SDK changes, update `ANDROID_SDK_PACKAGES` in both Dockerfiles; `src/repo/__tests__/androidSdk.test.ts` fails until you do. The first deploy after this change rebuilds that layer once.

To start from scratch (for example after a strange Gradle error), on .45:

```bash
docker volume rm pft-gradle-cache
```

## Versioning

`scripts/resolve-android-version-code.js` asks Google Play for every version code already used (bundles, APKs and every track's releases) and uses the highest plus one, or the workflow's optional `version_code` input if that is higher. `app.json`'s `versionCode` is only the floor. The user-facing Expo `version` is not changed by the workflow.

## Troubleshooting

- **Job never starts:** confirm `.45` is online and has labels `self-hosted`, `Windows`, `X64`, `personal-fitness-tracker-deploy` (runner name `personal-trainer`).
- **Missing secret:** the workflow fails before Docker build and names the missing environment mapping.
- **Signing failure:** verify alias and both passwords against the upload keystore with `keytool -list` locally.
- **Play authentication/permission failure:** verify the service account is linked/granted access to this Play Console app and Internal testing releases.
- **Version code already used:** run the workflow again; the resolver picks the next unused code from Play.
- **"Unexpected Android applicationId" / "Generated versionCode" / "Release build type is signed with …":** the generated Gradle project isn't what the script expects (usually an Expo template change). It fails before the build; the log prints the lines it found.
- **Gradle fails with a corrupt or locked cache:** clear the cache volume (see [Build cache on .45](#build-cache-on-45)) and run again.
- **Upload "kept failing after 8 attempts":** the network between `.45` and Google kept dropping. Check the connection and run again.
- **Upload refused for the signing key:** the keystore in the secrets isn't the upload key registered in Play Console (Setup → App signing).

## Deliberate constraints

There is no `push`, `pull_request` or schedule trigger; no GitHub-hosted runner; no `upload-artifact`/`download-artifact`; no production track option; and no AAB is retained as a GitHub artifact. Build and Play upload happen in the same Docker-backed job on `.45`.

The release scripts are tested with `npx jest --selectProjects scripts` (part of `npm test`), against a local fake of the Play API that also drops connections mid-upload.

## Health Connect (#36)

The app reads health data from Android Health Connect, read only (contract 12). Play Console needs the following before a release with it goes beyond internal testing. It may hold that release, or the permissions, until they are approved.

- **App content → Health apps:** declare exactly these permissions and their use:
  - `READ_STEPS`: daily step total in the Daily Log;
  - `READ_ACTIVE_CALORIES_BURNED`: daily active energy;
  - `READ_EXERCISE`: workouts (type and minutes);
  - `READ_WEIGHT`: weight tile and progress;
  - `READ_BODY_FAT`: body fat % (added in #46; **update an existing declaration** to include it);
  - `READ_SLEEP`: time asleep;
  - `READ_DISTANCE`: **not requested yet.** Optional recorded workout distance (#104) is switched off (`HC_DISTANCE`) until it is declared; see contract 12 for how to turn it on.

  No write, background or history permission is requested.
- **Privacy policy URL / Data safety:** the owner must supply an accessible policy URL and declarations reflecting all actual data flows in the shipped app, including AI configuration and health data sync (the screenshot import was removed in #138). Read-only Health Connect permissions do not establish that the entire app never collects or shares data. No legal/privacy declaration is made by this repository document; follow the [manual setup checklist](google-play-listing.md#one-time-manual-setup--owner-must-confirm) before publishing.
