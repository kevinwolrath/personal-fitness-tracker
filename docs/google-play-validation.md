# Play deployment-environment and Android verification follow-up

Historical 8 November 2026 follow-up to #100 / PR #101, before the canonical en-US migration. The old workflow runs below targeted a retired alternate locale; their outcomes remain historical evidence, not en-US validation results. Current behavior/results: [canonical en-US verification](google-play-en-us.md). **Nothing was committed in Play, submitted for review or released. No AAB was built or supplied.**

## Deployment environments — created and verified

| Setting | `google-play-validation` | `google-play-production` |
|---|---|---|
| Allowed deployment ref | Branch `develop` only; no tag rule | Branch `develop` only; no tag rule |
| Required reviewer | None for discardable validation | `kevinwolrath` |
| Self-review | Not applicable | Prevented |
| Admin bypass | No approval rule to bypass | Disabled |
| `PLAY_PUBLISH_APPROVED` | Not configured | **Not configured** |

The two environments reuse the existing repository-level `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` through the workflow. No secret was extracted, copied or replaced. Existing Android upload-key/password/alias secrets and signing configuration were untouched. No signing/build/release workflow was dispatched. Production commit remains disabled by the missing approval flag in addition to its reviewer/branch protections.

Because production self-review is prevented, Kevin cannot approve a production dispatch he initiated himself; a separately authorized operator would need to initiate it. Do not relax this or set the publishing flag without an explicit owner decision.

The follow-up branch was temporarily permitted **only in validation** to exercise the tested diagnostic fix. Its branch-policy exceptions were removed after each diagnostic run. Both environments were re-read afterward and allow only `develop`. Production never allowed the diagnostic branch.

## Actual workflow runs

| Run | Result / evidence |
|---|---|
| [Dry-run on develop](https://github.com/kevinwolrath/personal-fitness-tracker/actions/runs/42446312876) | **Passed.** Local bundle validation and summary passed; authenticated stage skipped. No Google API request. |
| [Original validate-only on develop](https://github.com/kevinwolrath/personal-fitness-tracker/actions/runs/42446652059) | Failed with the original generic error. No AAB; commit path was not entered. |
| [Redacted diagnostic retry](https://github.com/kevinwolrath/personal-fitness-tracker/actions/runs/42446825446) | Authentication succeeded, app listing read access worked. No existing alternate-locale listing; guard stopped before image upload. Temporary edit was deleted. |
| [Disposable-locale validation](https://github.com/kevinwolrath/personal-fitness-tracker/actions/runs/42447055227) | Authentication succeeded; approved alternate-locale copy was created **inside the temporary edit** and read back. Listing-write access and all six asset upload requests succeeded. **`edits.validate` returned HTTP 403.** Finally deleted the edit successfully. No commit, review submission, track update or AAB upload. |

**Validation is not green.** The current external blocker is the 403 at Google's validation endpoint, after staging succeeds. Authentication and listing-write permissions are proven; the exact additional permission/app-state requirement is not established by the status code. Do not claim this is an expired key, invent a policy rejection, or grant broad admin/production permissions as a guess. An owner/admin must inspect the service account's app-scoped grants and Console app requirements, resolve the refusal, then rerun validate-only. Never bypass validation or fall back to commit to test access.

Those old temporary edits were discarded. The canonical package now targets the existing en-US default listing exclusively. No new locale or default-language change is permitted by the current publisher; the historical temporary-locale path has been removed.

## Safe implementation improvements

- Failure logs now show only controlled operation labels, HTTP status and local validation errors. Raw Google response bodies, JSON-parser contents, JWTs and credentials remain omitted. Tests check secret-like response/parser strings are not echoed.
- Historical implementation allowed a temporary alternate locale inside a discarded validation edit. **Removed by the en-US migration.** Every authenticated mode now requires the existing en-US default and listing, uses PATCH, and refuses missing locale/default before changing content.
- Google documents that [edit changes are not live until committed](https://developers.google.com/android-publisher/edits). The current en-US publisher does not use locale-creation or app-details update methods.
- Local checks: **757 Jest tests passed / 55 suites**, including **28 release-automation tests**; TypeScript and offline bundle validation passed. No production screen behavior changed. The earlier #101 browser/native-export results remain recorded separately in [initial verification](google-play-listing-verification.md); they were not relabelled as new follow-up runs.

## Comparison with the actual Android app

Captured and visually examined Today, Today's Workout, exercise guide and Progress from the installed standalone Android app on the dedicated Pixel 9 emulator, API 35, 1080×2424, font scale 1.0. App version 0.1.0 / versionCode 1; installed APK SHA-256 is `c83de35115ceed8da49c448a03dbf7f45b6c454fe6d4dbc06490db8a08c3fda9`. [Device metadata](design/google-play-validation/native/verification.json).

| Store capture | Actual Android evidence | Finding |
|---|---|---|
| [Today](../store/google-play/en-US/images/phone/01-today.png) | [Native Today](design/google-play-validation/native/today.png) | Same shell, date/day-type controls, recommendation/workout/measurement structure and theme. Dates and activity copy differ because the store fixture uses the seed plan on Nov 2; the native test install uses its existing starter plan on Nov 8. |
| [Workout](../store/google-play/en-US/images/phone/02-workout.png) | [Native workout](design/google-play-validation/native/workout.png) | Same fixed Close, neutral front/back artwork, totals and checklist/info controls. Native starter equipment yields 4 eligible movements; seed plan yields 12. Both show zero done. |
| [Guide](../store/google-play/en-US/images/phone/03-guide.png) | [Native guide](design/google-play-validation/native/guide.png) | Same hero image containment, pager, captions, instructions and muscle information. Native no-equipment fixture opens knuckle push-up, not kettlebell squat. The exact store kettlebell JPEG is also present in this installed APK (`res/_b.jpg`), SHA-256 `51f27b642193dbdde36cec317174ce1e97d90bc66db6a2d4258f96c2a22f677c`. |
| [Progress](../store/google-play/en-US/images/phone/04-progress.png) | [Native Progress](design/google-play-validation/native/progress.png) | Same range controls, comparison and honest empty measurement cards. Native starter plan does not track waist; seed-plan fixture does. |

No fictitious feature or history was found in the store captures. Android uses its own font metrics, system bars, safe areas and native sheet presentation; the web images are **not pixel-identical Android screenshots**. This verifies the shared UI/artwork against the installed test APK, not a new signed Play bundle or the new launcher icon in that binary. Final binary/store review remains required before publication. Native evidence is not substituted into the upload package: its original tall device aspect ratio is retained, with no stretching/cropping. No logs, measurements, profile/equipment settings or Health Connect permissions were changed. Returned the emulator to Today with workout still 0/4.

## Remaining Play Console requirements

The private forms were not inspected or submitted. Browser access could not initialize in this session, and the Publishing API does not supply these legal consents. Treat their completion as **unverified**, rather than assuming missing or selecting answers automatically.

1. **Validation authorization/app state:** investigate the specific `edits.validate` 403. Review this app's service-account grants, access expiry and any Console app-content alerts with the owner. Listing-read, text/image editing and API authentication already worked. [Google's app-level permissions](https://developers.google.com/android-publisher/api-ref/rest/v3/grants) distinguish store management, testing releases and production releases; do not assume production/admin access is needed or grant it without approval.
2. **Locale:** canonical en-US uses the existing default listing; do not add a translation or switch the default. Current guards verify that state. The previous alternate-locale staging was discarded and is no longer an allowed code path.
3. **Privacy policy:** supply an owner-approved, public accessible URL and ensure the same policy is reachable from the app/Health Connect rationale. No concrete privacy URL is currently wired in tracked `app/`, `src/` or Expo configuration. The plugin's rationale intent/alias is not a substitute for the actual policy content/link. Specify actual purposes, processing, retention/deletion and contacts; do not invent them. [Health Connect publication guidance](https://developer.android.com/health-and-fitness/health-connect/publish).
4. **Data safety:** review the actual flows: Health Connect imports are read-only into local canonical observations; the screenshot extraction that sent images to Anthropic was removed in #138; health data sync sends the user's chosen data to the Body Anvil API. AI configuration instructions contain live configuration for user-directed external use; share/export can leave the device by user choice. Decide required/optional collection, purposes, sharing/service-provider treatment, retention and security from the shipped behavior and actual provider terms. Do not assert universal "no collection/sharing" or ephemeral retention. Google's [Data safety definitions](https://support.google.com/googleplay/android-developer/answer/10787469) require review even for off-device ephemeral processing.
5. **Health apps / Health Connect declaration:** complete/review the Health apps form and justify the seven permissions below (optional recorded workout distance added in #104), matching the shipped manifest and read-only feature. No write, background, medical-record or extra history permission is requested. [Health content policy](https://support.google.com/googleplay/android-developer/answer/16679511) and [sensitive API policy](https://support.google.com/googleplay/android-developer/answer/16558241). Review medical/non-medical classification and any required disclosures honestly; no medical claim or approval is invented here.
6. **Other account prerequisites:** confirm contact/support details, category, ratings, audience/ads declarations, countries/pricing, app access instructions if applicable, existing App Signing/upload certificate and testing eligibility. Confirm any applicable closed-testing/production-access requirements in the account. No replacement key, new app or release is needed merely to resolve this listing validation task.

| Declared read permission | Actual user-facing use |
|---|---|
| `READ_STEPS` | Recorded daily steps |
| `READ_ACTIVE_CALORIES_BURNED` | Active energy and energy display |
| `READ_EXERCISE` | Recorded workout types/minutes and progress |
| `READ_WEIGHT` | Daily weight and weight trend |
| `READ_BODY_FAT` | Recorded body-fat readings |
| `READ_SLEEP` | Recorded sleep duration |
| `READ_DISTANCE` | Optional same-source workout distance, displayed with walking duration; never estimated (#104) |

No account policy answers, permission upgrades, publishing approval flags, submissions, production changes or releases were made as a workaround.
