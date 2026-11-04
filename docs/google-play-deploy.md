# Google Play internal deployment

The workflow `.github/workflows/google-play-internal.yml` is **manual only** and runs only on the self-hosted Windows `.45` runner. Android tooling, signing and upload run inside Docker. It creates no GitHub Actions artifacts and cannot deploy to production: the container script fixes the track to `internal`.

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

PowerShell example for producing the keystore's base64 value locally (do not commit or paste the output into issues/logs):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\SigningKeys\personal-fitness-tracker-upload.jks')) | Set-Clipboard
```

The workflow decodes these only into a unique directory under `RUNNER_TEMP`, bind-mounts them read-only into the Docker container, and removes the temporary directory in a `finally` block.

## Google Play setup

1. Create the Play Console app with package `com.questspire.personalfitnesstracker` and enable Play App Signing.
2. Create/use a Google Cloud service account for automated Play uploads.
3. Grant that service account access to this app in Play Console with permission sufficient to create/update releases on the **Internal testing** track. Do not grant production permissions merely for this workflow.
4. Download its JSON key once, encode it into `GOOGLE_PLAY_SERVICE_ACCOUNT_B64`, then store/delete the local copy according to your credential-storage practice.
5. Add the upload certificate/key to Play Console when Play setup asks for it. Google owns the Play app-signing key; this repository uses only the upload key.

## Run

GitHub → Actions → **Deploy Android to Google Play Internal** → **Run workflow**.

The job prints the package, fixed `internal` target and versionCode before building. The container then:

1. generates the Android project (`expo prebuild`) and points the **release** build type at the upload key;
2. checks, before the ~25 minute Gradle build, that the applicationId, versionCode and release signing are right (a mismatch fails in seconds);
3. builds the signed AAB;
4. uploads it with `scripts/upload-play-bundle.js`: a resumable upload in 8 MiB chunks that, when the connection drops, asks Google how much arrived and continues from there (up to 8 attempts with backoff), then releases it to the internal track and commits.

The release then appears under Play Console → Testing → Internal testing. If the app has never been published, Play only accepts draft releases: the script then creates a **draft** internal release, and the log says so; roll it out in Play Console.

## Versioning

`scripts/resolve-android-version-code.js` asks Google Play for every version code already used (bundles, APKs and every track's releases) and uses the highest plus one, or the workflow's optional `version_code` input if that is higher. `app.json`'s `versionCode` is only the floor. The user-facing Expo `version` is not changed by the workflow.

## Troubleshooting

- **Job never starts:** confirm `.45` is online and has labels `self-hosted`, `Windows`, `X64`, `personal-fitness-tracker-deploy` (runner name `personal-trainer`).
- **Missing secret:** the workflow fails before Docker build and names the missing environment mapping.
- **Signing failure:** verify alias and both passwords against the upload keystore with `keytool -list` locally.
- **Play authentication/permission failure:** verify the service account is linked/granted access to this Play Console app and Internal testing releases.
- **Version code already used:** run the workflow again; the resolver picks the next unused code from Play.
- **"Unexpected Android applicationId" / "Generated versionCode" / "Release build type is signed with …":** the generated Gradle project isn't what the script expects (usually an Expo template change). It fails before the build; the log prints the lines it found.
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
  - `READ_SLEEP`: time asleep.

  No write, background or history permission is requested.
- **Privacy policy URL:** required for health permissions. It must say that health data is read from Health Connect, stays on the device, isn't shared, and nothing is written back. The app's Health Connect permission screen links to it (the rationale intent is wired by the library's config plugin).
- **Data safety:** "Health and fitness" data, collected and processed on the device, not shared, not required for the app to work.
