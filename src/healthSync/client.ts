import { z } from 'zod';
import type { Category, ShareRange, SyncSnapshot } from './payload';

/**
 * Client for the Body Anvil health-data API (#134, #163): the deployed Questspire Studio Worker, whose contract is
 * questspirestudio docs/body-anvil/SYNC_API.md (worker/index.mjs). Every request is HTTPS JSON. The owner token is
 * only ever sent in the Authorization header: never in a URL, a log line, an error message or a shared document.
 */

export const API_PREFIX = '/api/body-anvil/v1';
/** The Worker's snapshot limit (worker/snapshot.mjs SNAPSHOT_BYTES). */
export const MAX_UPLOAD_BYTES = 1024 * 1024;

export type Credential = { userId: string; ownerToken: string };

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const receipt = z.object({ updatedAt: z.string(), revision: z.string(), checksum: z.string() });
export type Receipt = z.infer<typeof receipt>;
const enrolled = receipt.extend({ ownerToken: hex64 });
const preview = z.object({ revision: z.string(), data: z.unknown() });
const created = z.object({ id: z.string(), url: z.string().url(), expiresAt: z.string() });
export type ShareLink = z.infer<typeof created>;
export type RemoteSnapshot = { snapshot: unknown; updatedAt: string | null; revision: string | null };
/** What a link shares (the Worker's scope; `expiresIn` in seconds, 60 to 86,400). */
export type ShareScope = { range: ShareRange; categories: Category[]; format: 'records' | 'summary'; expiresIn: number };

export type SyncErrorKind = 'offline' | 'auth' | 'enrollmentKey' | 'notFound' | 'conflict' | 'tooLarge' | 'rateLimited' | 'invalid' | 'server' | 'badResponse' | 'config' | 'unavailable';
/** The Worker's `{"error": "…"}` reason (#181): one line, printable, at most 200 characters; null when there isn't one. */
async function serverReason(res: { text(): Promise<string> }): Promise<string | null> {
  try {
    const body = JSON.parse(await res.text()) as { error?: unknown };
    if (typeof body?.error !== 'string') return null;
    const clean = body.error.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, 200);
    return clean || null;
  } catch {
    return null;
  }
}

export class SyncError extends Error {
  constructor(readonly kind: SyncErrorKind, message: string, readonly status: number | null = null, readonly retryAfterSeconds: number | null = null, readonly reason: string | null = null) {
    super(message);
    this.name = 'SyncError';
  }
}

const messages: Record<SyncErrorKind, string> = {
  offline: 'Couldn’t reach the server. Check your connection and try again.',
  auth: 'The server didn’t accept this phone’s key.',
  enrollmentKey: 'The server didn’t accept this app’s enrollment key, so this phone isn’t linked yet. Nothing was changed; try again after updating the app.',
  notFound: 'That isn’t on the server (any more).',
  conflict: 'The server already has this data ID linked to another phone.',
  tooLarge: 'That’s more data than the server accepts in one upload.',
  rateLimited: 'Too many requests. Wait a minute and try again.',
  invalid: 'The server rejected the data as invalid. Nothing was changed.',
  server: 'The server had a problem. Try again later.',
  unavailable: 'The server isn’t taking new links right now. Try again later.',
  badResponse: 'The server sent a reply the app doesn’t understand.',
  config: 'This version of the app has no valid sync server configured, so nothing was sent.',
};
const kindFor = (status: number, enrolling: boolean): SyncErrorKind =>
  enrolling && status === 401 ? 'enrollmentKey'
    : enrolling && status === 503 ? 'unavailable'
      : status === 401 || status === 403 ? 'auth'
        : status === 404 ? 'notFound'
          : status === 409 ? 'conflict'
            : status === 413 ? 'tooLarge'
              : status === 429 ? 'rateLimited'
                : status === 400 || status === 415 || status === 422 ? 'invalid'
                  : 'server';

/**
 * A development machine's address, reachable from a dev build (#146): this computer (`localhost`, 127.0.0.1), the
 * Android emulator's alias for it (10.0.2.2, inside 10/8), or a private LAN address (a physical phone on the same
 * Wi-Fi as the dev PC).
 */
export function isDevHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

/**
 * The API base URL as an origin plus optional path, without a trailing slash; null when unusable. `https://` always;
 * `http://` only for a dev build (`dev: true`) talking to a development host (isDevHost). Never credentials, a query
 * or a fragment in the address. A trailing `/api/body-anvil/v1` is dropped, since the client adds it (#155).
 */
export function normalizeBaseUrl(input: string, opts: { dev?: boolean } = {}): string | null {
  try {
    const u = new URL(input.trim());
    const ok = u.protocol === 'https:' || (u.protocol === 'http:' && !!opts.dev && isDevHost(u.hostname));
    if (!ok) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    // #155: a value that already ends in the API path would double it (…/v1/api/body-anvil/v1/enroll → 404). Drop it.
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.origin}${path.endsWith(API_PREFIX) ? path.slice(0, -API_PREFIX.length) : path}`;
  } catch {
    return null;
  }
}

type Res = { status: number; headers: { get(name: string): string | null }; text(): Promise<string> };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<Res>;

export function healthSyncClient(baseUrl: string, fetchImpl: Fetch, opts: { dev?: boolean } = {}) {
  const base = normalizeBaseUrl(baseUrl, opts);
  const send = async (method: string, path: string, o: { token?: string; body?: unknown; enrollmentKey?: string } = {}): Promise<Res> => {
    if (!base) throw new SyncError('config', messages.config);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (o.token) headers.Authorization = `Bearer ${o.token}`;
    // #136: the shared enrollment key goes only on the enroll request, only in this header.
    if (o.enrollmentKey) headers['X-Enrollment-Key'] = o.enrollmentKey;
    let body: string | undefined;
    if (o.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(o.body);
    }
    let res: Res;
    try {
      res = await fetchImpl(`${base}${API_PREFIX}${path}`, { method, headers, body });
    } catch {
      throw new SyncError('offline', messages.offline);
    }
    if (res.status < 200 || res.status >= 300) {
      const kind = kindFor(res.status, !!o.enrollmentKey);
      const retry = Number(res.headers.get('Retry-After'));
      // #181: say what the server objected to. Only its short reason is kept; a token or the data is never in it.
      const reason = kind === 'invalid' || kind === 'tooLarge' || kind === 'conflict' ? await serverReason(res) : null;
      const message = reason ? `${messages[kind].replace(/\. Nothing was changed\.$|\.$/, '')} (server: ${reason}).${/Nothing was changed/.test(messages[kind]) ? ' Nothing was changed.' : ''}` : messages[kind];
      throw new SyncError(kind, message, res.status, Number.isFinite(retry) && retry > 0 ? retry : null, reason);
    }
    return res;
  };
  const parse = async <T>(res: Res, schema: z.ZodType<T>): Promise<T> => {
    let json: unknown;
    try {
      json = JSON.parse(await res.text());
    } catch {
      throw new SyncError('badResponse', messages.badResponse, res.status);
    }
    const r = schema.safeParse(json);
    if (!r.success) throw new SyncError('badResponse', messages.badResponse, res.status);
    return r.data;
  };
  const user = (c: Credential) => `/users/${encodeURIComponent(c.userId)}`;
  return {
    /**
     * First use: link this data ID with its first snapshot. Retrying with the same retry key returns the same owner
     * token and the stored receipt (it never replaces the stored snapshot). `enrollmentKey` (#136) is the build's
     * shared key, sent as `X-Enrollment-Key` on this request (and its retries) only.
     */
    enroll: async (uuid: string, retryKey: string, snapshot: SyncSnapshot, enrollmentKey: string) => {
      const res = await send('POST', '/enroll', { body: { uuid, retryKey, snapshot }, enrollmentKey });
      // 201: linked with this snapshot. 200: a retry of an earlier link; the stored snapshot is that attempt's.
      return { ...(await parse(res, enrolled)), created: res.status === 201 };
    },
    /** Replace the latest snapshot for this data ID. */
    putSnapshot: async (c: Credential, snapshot: SyncSnapshot) => parse(await send('PUT', `${user(c)}/snapshot`, { token: c.ownerToken, body: snapshot }), receipt),
    /** The owner's latest snapshot, read-only. Its time and revision come in headers. */
    getSnapshot: async (c: Credential): Promise<RemoteSnapshot> => {
      const res = await send('GET', `${user(c)}/snapshot`, { token: c.ownerToken });
      const snapshot = await parse(res, z.unknown());
      return { snapshot, updatedAt: res.headers.get('X-Body-Anvil-Updated-At'), revision: res.headers.get('X-Body-Anvil-Revision') };
    },
    /** Exactly what a link with this scope would share, from the stored snapshot, with the revision it came from. */
    previewShare: async (c: Credential, scope: ShareScope) => parse(await send('POST', `${user(c)}/shares/preview`, { token: c.ownerToken, body: scope }), preview),
    /** A read-only link to exactly the previewed data (fails with 409 if the snapshot changed since the preview). */
    createShare: async (c: Credential, scope: ShareScope, revision: string) =>
      parse(await send('POST', `${user(c)}/shares`, { token: c.ownerToken, body: { ...scope, revision } }), created),
    revokeShare: async (c: Credential, shareId: string) => {
      await send('DELETE', `${user(c)}/shares/${encodeURIComponent(shareId)}`, { token: c.ownerToken });
    },
  };
}
export type HealthSyncClient = ReturnType<typeof healthSyncClient>;
