/**
 * Build-time configuration for health data sync (#134, #136).
 *
 * `EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY` is the shared enrollment key the Questspire Studio Worker expects in
 * `X-Enrollment-Key` on the first link (enroll). It is inlined into the JS bundle when the app is built:
 * - Google Play builds: from the GitHub Actions secret `BODY_ANVIL_ENROLLMENT_KEY` (google-play-internal.yml);
 * - local web / Android development: from `.env.local` (git-ignored), see docs/health-sync-api.md.
 *
 * It only deters casual enrollment: anything bundled into an app can be extracted. It is never typed by the user,
 * stored, logged, put in a snapshot or share, or sent on any request except enroll.
 *
 * Read with the literal `process.env.EXPO_PUBLIC_…` member access: that is what Expo replaces at build time.
 */
export const BUILD_ENROLLMENT_KEY: string = (process.env.EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY ?? '').trim();

/** The API address for this build, if set (the user can change it in the sheet). */
export const BUILD_HEALTH_SYNC_URL: string = process.env.EXPO_PUBLIC_HEALTH_SYNC_URL ?? '';
