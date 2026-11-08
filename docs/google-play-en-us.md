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

Migration byte comparison passed: **10/10 files identical**, including **6/6 images**. The package remains `com.questspire.personalfitnesstracker`. Local release automation tests and dry-run pass; final repository/workflow results are recorded below before PR review.

The previous alternate-locale run reached `edits.validate` and received HTTP 403 after successful staging and cleanup. That historical result does not prove whether the existing en-US default has the same blocker. No permission escalation, publishing approval flag or workaround commit is used to bypass validation.

Privacy policy wiring, owner-reviewed Data safety and the exact six Health Connect read-permission declarations remain Console/application requirements described in the [declaration checklist](google-play-validation.md#remaining-play-console-requirements); this locale migration does not invent or submit those answers.
