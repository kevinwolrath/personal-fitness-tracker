import { z } from 'zod';
import type { HealthPayload, Scope } from './payload';

/**
 * Client for the Body Anvil health-data API (#134). The backend (Cloudflare Worker + D1) lives in Questspire Studio;
 * this is the app side of the contract in docs/health-sync-api.md. Every request is HTTPS JSON. The owner token is
 * only ever sent in the Authorization header: never in a URL, a log line, an error message or a shared document.
 */

export const API_PREFIX = '/api/body-anvil/v1';
/** Largest document the app sends; the server enforces its own limit (413). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type Credential = { userId: string; ownerToken: string };

const receipt = z.object({ etag: z.string(), uploadedAt: z.string(), bytes: z.number().int().nonnegative() });
export type Receipt = z.infer<typeof receipt>;
const enrolled = z.object({ userId: z.string(), ownerToken: z.string().min(16), snapshot: receipt });
const share = z.object({
  shareId: z.string(),
  url: z.string().url(),
  createdAt: z.string(),
  expiresAt: z.string(),
  revokedAt: z.string().nullable().optional(),
  scope: z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90), z.null()]), categories: z.array(z.string()) }),
  bytes: z.number().int().nonnegative().optional(),
});
export type ShareLink = z.infer<typeof share>;
const shareList = z.object({ shares: z.array(share.omit({ url: true }).extend({ url: z.string().url().optional() })) });
export type ShareSummary = z.infer<typeof shareList>['shares'][number];
const remote = z.object({ snapshot: z.unknown(), etag: z.string(), uploadedAt: z.string(), bytes: z.number().int().nonnegative() });
export type RemoteSnapshot = z.infer<typeof remote>;

export type SyncErrorKind = 'offline' | 'auth' | 'enrollmentKey' | 'notFound' | 'conflict' | 'tooLarge' | 'rateLimited' | 'invalid' | 'server' | 'badResponse' | 'config';
export class SyncError extends Error {
  constructor(readonly kind: SyncErrorKind, message: string, readonly status: number | null = null, readonly retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'SyncError';
  }
}

const messages: Record<SyncErrorKind, string> = {
  offline: 'Couldn’t reach the server. Check your connection and try again.',
  auth: 'The server didn’t accept this phone’s key.',
  enrollmentKey: 'The server didn’t accept this app’s enrollment key, so this phone isn’t linked yet. Nothing was changed; try again after updating the app.',
  notFound: 'Nothing is stored on the server yet.',
  conflict: 'The server already has this data ID linked to another phone.',
  tooLarge: 'That’s more data than the server accepts in one upload.',
  rateLimited: 'Too many requests. Wait a minute and try again.',
  invalid: 'The server rejected the data as invalid.',
  server: 'The server had a problem. Try again later.',
  badResponse: 'The server sent a reply the app doesn’t understand.',
  config: 'The server address isn’t set or isn’t a secure https:// address.',
};
const kindFor = (status: number): SyncErrorKind =>
  status === 401 || status === 403 ? 'auth' : status === 404 ? 'notFound' : status === 409 ? 'conflict' : status === 413 ? 'tooLarge' : status === 429 ? 'rateLimited' : status === 400 || status === 422 ? 'invalid' : 'server';

/** An https:// origin (http:// only for localhost while developing), without a trailing slash; else null. */
export function normalizeBaseUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '10.0.2.2';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    if (u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export function healthSyncClient(baseUrl: string, fetchImpl: Fetch) {
  const base = normalizeBaseUrl(baseUrl);
  const call = async <T>(method: string, path: string, parse: z.ZodType<T> | null, opts: { token?: string; body?: unknown; enrollmentKey?: string } = {}): Promise<T> => {
    if (!base) throw new SyncError('config', messages.config);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
    // #136: the shared enrollment key goes only on the enroll request, only in this header.
    if (opts.enrollmentKey) headers['X-Enrollment-Key'] = opts.enrollmentKey;
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }
    let res: Awaited<ReturnType<Fetch>>;
    try {
      res = await fetchImpl(`${base}${API_PREFIX}${path}`, { method, headers, body });
    } catch {
      throw new SyncError('offline', messages.offline);
    }
    if (res.status < 200 || res.status >= 300) {
      // A rejected enroll (401/403) is about the enrollment key: there is no owner token yet.
      const kind = opts.enrollmentKey && (res.status === 401 || res.status === 403) ? 'enrollmentKey' : kindFor(res.status);
      const retry = Number(res.headers.get('Retry-After'));
      throw new SyncError(kind, messages[kind], res.status, Number.isFinite(retry) && retry > 0 ? retry : null);
    }
    if (!parse) return undefined as T;
    let json: unknown;
    try {
      json = JSON.parse(await res.text());
    } catch {
      throw new SyncError('badResponse', messages.badResponse, res.status);
    }
    const r = parse.safeParse(json);
    if (!r.success) throw new SyncError('badResponse', messages.badResponse, res.status);
    return r.data;
  };
  const user = (c: Credential) => `/users/${encodeURIComponent(c.userId)}`;
  return {
    /**
     * First use: link this data ID. Retrying with the same enrollment secret returns the same link (idempotent).
     * `enrollmentKey` (#136) is the build's shared key, sent as `X-Enrollment-Key` on this request (and its retries) only.
     */
    enroll: (userId: string, enrollmentSecret: string, snapshot: HealthPayload, enrollmentKey: string) =>
      call('POST', '/enroll', enrolled, { body: { userId, enrollmentSecret, snapshot }, enrollmentKey }),
    /** Replace the latest snapshot for this data ID. */
    putSnapshot: (c: Credential, snapshot: HealthPayload) => call('PUT', `${user(c)}/snapshot`, receipt, { token: c.ownerToken, body: snapshot }),
    /** The owner's latest snapshot, read-only. */
    getSnapshot: (c: Credential) => call('GET', `${user(c)}/snapshot`, remote, { token: c.ownerToken }),
    /** A read-only link to exactly this document, expiring after `expiresInHours`. */
    createShare: (c: Credential, scope: Scope, expiresInHours: 1 | 24, document: HealthPayload) =>
      call('POST', `${user(c)}/shares`, share, { token: c.ownerToken, body: { scope, expiresInHours, document } }),
    listShares: (c: Credential) => call('GET', `${user(c)}/shares`, shareList, { token: c.ownerToken }).then((r) => r.shares),
    revokeShare: (c: Credential, shareId: string) => call('DELETE', `${user(c)}/shares/${encodeURIComponent(shareId)}`, null, { token: c.ownerToken }),
  };
}
export type HealthSyncClient = ReturnType<typeof healthSyncClient>;
