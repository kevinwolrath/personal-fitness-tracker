# Canonical Google Play listing locale: en-US

The repository's only Play listing package is now `store/google-play/en-US/`, targeting the **existing en-US default listing** for `com.questspire.personalfitnesstracker`. No locale is created, renamed or removed in Google Play, and app details/default language are never written. Existing translations outside this managed package remain untouched.

## Migration and preservation

- Moved the ten existing text/image files without changing any bytes. All six approved graphics/screenshots retain their exact SHA-256 values, dimensions and provenance. The Body Anvil name, anvil emblem, three heroes, costumes and muscle maps are preserved.
- Migrated manifest default/allowed locale, image paths, Expo icon path, preparer output/browser locale, publisher routes/release notes, workflow summary, tests and active documentation to en-US.
- The package ID, signing keys, app data identity, application time zone and ordinary app regional behavior are unchanged. This is a store-listing migration, with no application layout or new artwork.
- Historical verification documents retain their actual old run outcomes and identify them as pre-migration evidence. Their current asset links point at en-US; old failures are not relabelled as en-US results.

## Authenticated operation contract

1. Validate the local manifest, sole locale directory, text and image hashes offline.
2. Create a temporary edit and **GET** its app details. Require `defaultLanguage === 'en-US'`.
3. **GET** its listings. Require an already-existing en-US entry. Missing/incorrect defaults or missing listings fail before any content update and discard the edit.
4. **PATCH** only `/listings/en-US`; update only its managed icon/feature/phone images. Release notes use en-US when an explicitly supplied AAB is authorized. There is no listing PUT/create path or app-details PATCH/PUT in any mode.
5. Validate the edit. `validate-only` always deletes it. Existing protected commit controls remain; no commit/submission is authorized by this migration task.

`dry-run` remains credential-free with zero API calls. Tests cover missing/wrong default, missing listing in both validation and commit, cleanup, en-US routes/body/release notes, no locale creation/default writes, rejection of other local locale directories, image integrity, and existing approval/production guards.

Google documents the read-only [app default-language field](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details) and [app-details GET](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.details/get). The tool checks those values rather than treating a missing default listing as permission to create a translation.

## Verification

Migration byte comparison passed: **10/10 files identical**, including **6/6 images**. Git records every moved asset/copy file as a 100% rename. The package remains `com.questspire.personalfitnesstracker`.

| Check | Result |
|---|---|
| Full Jest | **758 passed / 55 suites**, including **29 release-automation tests** |
| TypeScript | Passed |
| Android + iOS export | Passed; migrated icon resolved |
| Local `npm run store:validate` | Passed; en-US, six images, zero API requests |
| Isolated development smoke | 1 passed |
| Full production browser suite | **432 passed, 108 skipped, 21 failed**; same recorded failure set: 17 visual comparisons, three clipboard/share cases and one small-phone meal interaction |
| Workflow YAML / script syntax / diff checks | Passed |
| [Workflow dry-run](https://github.com/kevinwolrath/personal-fitness-tracker/actions/runs/42451234863) | **Passed** on the migration branch |
| [No-AAB validate-only](https://github.com/kevinwolrath/personal-fitness-tracker/actions/runs/42451349539) | Authenticated; existing en-US default/listing confirmed; text and six asset uploads staged; final `edits.validate` **HTTP 403**; edit successfully discarded |

The remaining API blocker is now reproduced against the **existing en-US default**, rather than inferred from the historical alternate-locale run. Google accepted the default/listing reads, text patch and six upload requests, then refused `edits.validate` with HTTP 403. The exact additional app-level permission or Console state requirement remains unverified. An owner/admin must investigate the refusal; do not rotate a working key, grant broad production/admin permissions as a guess, or bypass validation by committing. No new locale/default update, AAB upload, track update, commit, review submission or release occurred.

The workflow used existing credentials. A temporary migration-branch exception was applied only to `google-play-validation` for the two tests and removed afterward. Validation and production are again develop-only; production retains required owner review, blocked self-review/admin bypass and an unset publishing approval flag.

No UI baselines were refreshed. Documentation captures rewritten by the existing browser tests were restored and excluded from the migration. No new screenshots/artwork were generated; the byte-preservation check was repeated after the checks. Remaining unrelated application/test `en-AU` settings are date/number formatting and general app fixtures, not Play listing locale configuration, and are intentionally unchanged.

Privacy policy wiring, owner-reviewed Data safety and the exact six Health Connect read-permission declarations remain Console/application requirements described in the [declaration checklist](google-play-validation.md#remaining-play-console-requirements); this locale migration does not invent or submit those answers.

App follow-up #104 adds optional `READ_DISTANCE` for recorded workout distance: the current declaration checklist now has seven read permissions. The locale migration itself made no permission changes.
