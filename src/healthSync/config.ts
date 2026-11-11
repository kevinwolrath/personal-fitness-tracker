import { normalizeBaseUrl } from './client';

/**
 * Build-time configuration for health data sync (#134, #136, #146): the one place the app reads it. Both values are
 * inlined into the JS bundle when the app is built, from `EXPO_PUBLIC_` variables, and read here with the literal
 * `process.env.EXPO_PUBLIC_…` member access (that is what Expo replaces at build time). Users never enter either.
 *
 * - **API base URL**, `EXPO_PUBLIC_BODY_ANVIL_API_URL`: the Questspire Studio Body Anvil API. Google Play builds get it
 *   from the GitHub Actions repository variable `BODY_ANVIL_API_URL`; local web and Android builds from `.env.local`.
 *   There is no default: without a valid value, sync and sharing are off and say so.
 * - **Enrollment key**, `EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY`: sent only as `X-Enrollment-Key` on the first link.
 *   Play builds get it from the secret `BODY_ANVIL_ENROLLMENT_KEY`. It deters casual enrollment; anything bundled
 *   into an app can be extracted.
 *
 * See docs/health-sync-api.md.
 */

export type ApiUrlConfig =
  | { ok: true; url: string }
  | { ok: false; problem: 'missing' | 'invalid' | 'insecure'; message: string };

const NOT_CONFIGURED = 'This version of the app has no sync server configured, so syncing and sharing are off.';

/**
 * Validate the build's API URL. Pure. Release builds need `https://`; dev builds may also use `http://` to a
 * development host (localhost, 10.0.2.2 for the Android emulator, a private LAN address for a physical phone).
 * Never falls back to any other address.
 */
export function resolveApiUrl(raw: string | undefined, opts: { dev: boolean }): ApiUrlConfig {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, problem: 'missing', message: NOT_CONFIGURED };
  const url = normalizeBaseUrl(value, { dev: opts.dev });
  if (url) return { ok: true, url };
  let insecure = false;
  try {
    insecure = new URL(value).protocol === 'http:';
  } catch {
    // not a URL at all
  }
  return insecure
    ? { ok: false, problem: 'insecure', message: 'This version of the app has an insecure (http://) sync server address, so syncing and sharing are off.' }
    : { ok: false, problem: 'invalid', message: NOT_CONFIGURED };
}

/** True in development builds (Metro / `expo run:android`), false in exported release bundles. */
export const DEV_BUILD: boolean = typeof __DEV__ !== 'undefined' && __DEV__;

/** The API base URL for this build, validated once. */
export const BUILD_API: ApiUrlConfig = resolveApiUrl(process.env.EXPO_PUBLIC_BODY_ANVIL_API_URL, { dev: DEV_BUILD });

export const BUILD_ENROLLMENT_KEY: string = (process.env.EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY ?? '').trim();
