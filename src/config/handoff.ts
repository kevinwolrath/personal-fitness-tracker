/**
 * #120 proof of concept: a configuration update handed to the app in a link, e.g. from a chat assistant's reply.
 *
 *   personalfitnesstracker://configure?v=1&update=<URL-encoded fitnessConfigUpdate JSON>
 *
 * The link only *carries* text. It is untrusted: it goes through the same importer, validation, preview and
 * explicit "Apply N changes" as a pasted update (contract 07). Nothing is applied, stored or logged on arrival.
 * Plain URL-encoded JSON, not base64: assistants produce percent-encoding far more reliably than base64, and a
 * person can read it. See docs/config-link-poc.md for device results, limits and the recommendation.
 */

/** Version of the link format itself (the update inside carries its own schemaVersion). */
export const CONFIG_LINK_VERSION = 1;
/** The app's custom scheme (app.json "scheme"). */
export const CONFIG_LINK_SCHEME = 'personalfitnesstracker';
/**
 * Upper bound for the decoded update text. Android intents carry far more, but long links get cut or wrapped by
 * chat apps and browsers; a focused update is a few hundred characters. Larger updates use Copy and Paste.
 */
export const CONFIG_LINK_MAX_CHARS = 4000;

/**
 * Off in production builds: a test-only handler for the experiment. On in development, and in any build exported
 * with EXPO_PUBLIC_CONFIG_LINK_POC=1 (the Playwright web export and a test APK).
 */
export const configLinkEnabled = (): boolean =>
  (typeof __DEV__ !== 'undefined' && __DEV__) || process.env.EXPO_PUBLIC_CONFIG_LINK_POC === '1';

/** Build a link for an update (tests, `scripts/config-link.cjs`, and what an assistant is asked to produce). */
export function buildConfigLink(updateJson: string): string {
  return `${CONFIG_LINK_SCHEME}://configure?v=${CONFIG_LINK_VERSION}&update=${encodeURIComponent(updateJson)}`;
}

export type LinkRead = { ok: true; text: string } | { ok: false; error: string };

/**
 * Read the `update` and `v` search params of an opened link (expo-router has already percent-decoded them once).
 * Only checks the envelope of the link: the text itself is checked by the normal importer.
 */
export function readConfigLink(params: { update?: string | string[]; v?: string | string[] }): LinkRead | null {
  const raw = params.update;
  if (raw === undefined) return null;
  if (Array.isArray(raw)) return { ok: false, error: 'This link has more than one update in it. Nothing was changed.' };
  const v = Array.isArray(params.v) ? params.v[0] : params.v;
  if (v !== undefined && v !== String(CONFIG_LINK_VERSION)) {
    return { ok: false, error: `This link uses a format this version of the app doesn't know (v=${v}). Nothing was changed. Copy the update and use Paste instead.` };
  }
  let text = raw;
  // A link that was percent-encoded twice (some chat apps and browsers re-encode) still reads.
  if (!text.includes('{') && /%7B/i.test(text)) {
    try {
      text = decodeURIComponent(text);
    } catch {
      return { ok: false, error: "This link's update is damaged (bad encoding). Nothing was changed. Copy the update and use Paste instead." };
    }
  }
  if (text.trim() === '') return { ok: false, error: 'This link has an empty update. Nothing was changed.' };
  if (text.length > CONFIG_LINK_MAX_CHARS) {
    return { ok: false, error: `This link's update is too long (${text.length} characters, limit ${CONFIG_LINK_MAX_CHARS}). Nothing was changed. Copy the update and use Paste instead.` };
  }
  return { ok: true, text };
}
