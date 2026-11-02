# Google Play internal deployment

The workflow `.github/workflows/google-play-internal.yml` is **manual only** and runs only on the self-hosted Windows `.45` runner. Android tooling, signing and upload run inside Docker. It creates no GitHub Actions artifacts and cannot deploy to production: the container script fixes the track to `internal`.

## Immutable app identity

- Android package: `com.questspire.personalfitnesstracker`
- Play track: `internal`

## GitHub Actions secrets

Configure these repository Actions secrets:

- `ANDROID_UPLOAD_KEYSTORE_B64` — base64 of `personal-fitness-tracker-upload.jks`
- `ANDROID_UPLOAD_KEYSTORE_PASSWORD` — keystore password
- `ANDROID_UPLOAD_KEY_ALIAS` — `personal-fitness-tracker` (or the alias actually used when the key was generated)
- `ANDROID_UPLOAD_KEY_PASSWORD` — key password
- `GOOGLE_PLAY_SERVICE_ACCOUNT_B64` — base64 of the Google Play service-account JSON key

PowerShell examples for producing the two base64 values locally (do not commit or paste the output into issues/logs):

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\SigningKeys\personal-fitness-tracker-upload.jks')) | Set-Clipboard
[Convert]::ToBase64String([IO.File]::ReadAllBytes('C:\SigningKeys\google-play-service-account.json')) | Set-Clipboard
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

The job prints the package, fixed `internal` target and generated versionCode before building/uploading. The release then appears under Play Console → Testing → Internal testing.

## Versioning

The workflow uses current UTC Unix epoch seconds as Android `versionCode`. It is monotonically increasing for normal manual runs and remains below Android's maximum versionCode until 2038. The user-facing Expo `version` is not changed by the workflow.

## Troubleshooting

- **Job never starts:** confirm `.45` is online and has labels `self-hosted`, `Windows`, `X64`, `.45`.
- **Missing secret:** the workflow fails before Docker build and names the missing environment mapping.
- **Signing failure:** verify alias and both passwords against the upload keystore with `keytool -list` locally.
- **Play authentication/permission failure:** verify the service account is linked/granted access to this Play Console app and Internal testing releases.
- **Version code already used:** run the workflow again; a new epoch-seconds versionCode is generated.

## Deliberate constraints

There is no `push`, `pull_request` or schedule trigger; no GitHub-hosted runner; no `upload-artifact`/`download-artifact`; no production track option; and no AAB is retained as a GitHub artifact. Build and Play upload happen in the same Docker-backed job on `.45`.
