import type { LocalDate } from '../plan/dates';
import type { TrackingStore } from '../storage/types';
import { MAX_UPLOAD_BYTES, SyncError, type Credential, type HealthSyncClient, type Receipt } from './client';
import { buildHealthPayload, FULL_SCOPE, utf8Bytes, type HealthPayload, type Scope } from './payload';

/**
 * Health data sync (#134), app side. Nothing here runs on its own: every upload, link and download is a tap.
 *
 * - **Data ID**: a random UUID made once per install of the data, kept in the local database (`app_meta`), so a full
 *   backup (#128) carries it to a new phone.
 * - **Owner token**: issued by the server when this phone first links; kept only in secure storage (keystore). Never in
 *   the database, a backup, an export, a log, a URL or a shared document. Stored with its data ID, so a token from a
 *   different ID (e.g. after restoring someone else's backup) is never used.
 * - **Enrollment secret**: random, saved *before* the first link request, so an interrupted link can be retried and the
 *   server returns the same link instead of a second one.
 */

export const USER_ID_KEY = 'healthSync.userId';
export const SECRET_KEYS = { credential: 'pft.healthSync.credential', pending: 'pft.healthSync.pending', status: 'pft.healthSync.status', url: 'pft.healthSync.url' } as const;

export type SecretStore = { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; remove(key: string): Promise<void> };
export type SyncStatus = { at: string; ok: boolean; bytes: number; message: string; lastSuccessAt: string | null; uploadedAt: string | null };
export type SyncDeps = {
  store: TrackingStore;
  client: HealthSyncClient;
  secrets: SecretStore;
  now: () => string;
  today: LocalDate;
  appVersion: string;
  /** A random UUID v4. */
  uuid: () => string;
  /** A random, unguessable secret (at least 128 bits), as text. */
  randomSecret: () => string;
};

const readJson = async <T>(secrets: SecretStore, key: string): Promise<T | null> => {
  try {
    const raw = await secrets.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

/** This data's ID: made once, then always the same (startup calls this too). */
export const ensureUserId = (store: TrackingStore, uuid: () => string) => store.ensureMeta(USER_ID_KEY, uuid());

/** The owner credential for this data ID, or null (never linked here, or a token belonging to another ID). */
export async function credentialFor(secrets: SecretStore, userId: string): Promise<Credential | null> {
  const c = await readJson<Credential>(secrets, SECRET_KEYS.credential);
  return c && c.userId === userId && typeof c.ownerToken === 'string' ? c : null;
}

export async function syncStatus(secrets: SecretStore): Promise<SyncStatus | null> {
  return readJson<SyncStatus>(secrets, SECRET_KEYS.status);
}

export async function serverUrl(secrets: SecretStore, fallback: string): Promise<string> {
  return (await secrets.get(SECRET_KEYS.url).catch(() => null)) || fallback;
}

/** Everything this phone holds, as the upload document, with its size. Reads only. */
export async function fullPayload(d: Pick<SyncDeps, 'store' | 'now' | 'today' | 'appVersion'>, scope: Scope = FULL_SCOPE): Promise<{ payload: HealthPayload; bytes: number }> {
  const payload = buildHealthPayload(await d.store.snapshot(), { generatedAt: d.now(), today: d.today, appVersion: d.appVersion }, scope);
  return { payload, bytes: utf8Bytes(JSON.stringify(payload)) };
}

export type SyncResult = { ok: true; linked: boolean; receipt: Receipt; bytes: number } | { ok: false; error: SyncError; bytes: number };

/** Sync my data: link on first use, else replace the latest snapshot. Records the outcome. Never throws. */
export async function syncNow(d: SyncDeps): Promise<SyncResult> {
  let bytes = 0;
  const previous = await syncStatus(d.secrets);
  const record = async (ok: boolean, message: string, uploadedAt: string | null) => {
    const status: SyncStatus = { at: d.now(), ok, bytes, message, lastSuccessAt: ok ? d.now() : previous?.lastSuccessAt ?? null, uploadedAt: ok ? uploadedAt : previous?.uploadedAt ?? null };
    await d.secrets.set(SECRET_KEYS.status, JSON.stringify(status)).catch(() => undefined);
  };
  try {
    const userId = await ensureUserId(d.store, d.uuid);
    const built = await fullPayload(d);
    bytes = built.bytes;
    if (bytes > MAX_UPLOAD_BYTES) throw new SyncError('tooLarge', 'That’s more data than one upload allows. Share a shorter period instead, or use Back up data.');
    const cred = await credentialFor(d.secrets, userId);
    if (cred) {
      const receipt = await d.client.putSnapshot(cred, built.payload);
      await record(true, 'Uploaded', receipt.uploadedAt);
      return { ok: true, linked: false, receipt, bytes };
    }
    // First link. Reuse a saved enrollment secret for this ID so a retry after an interruption is the same request.
    const saved = await readJson<{ userId: string; secret: string }>(d.secrets, SECRET_KEYS.pending);
    const pending = saved?.userId === userId ? saved : { userId, secret: d.randomSecret() };
    if (pending !== saved) await d.secrets.set(SECRET_KEYS.pending, JSON.stringify(pending));
    const r = await d.client.enroll(userId, pending.secret, built.payload);
    if (r.userId !== userId) throw new SyncError('badResponse', 'The server linked a different data ID. Nothing was saved on this phone.');
    await d.secrets.set(SECRET_KEYS.credential, JSON.stringify({ userId, ownerToken: r.ownerToken } satisfies Credential));
    await d.secrets.remove(SECRET_KEYS.pending).catch(() => undefined);
    await record(true, 'Linked and uploaded', r.snapshot.uploadedAt);
    return { ok: true, linked: true, receipt: r.snapshot, bytes };
  } catch (e) {
    const error = e instanceof SyncError ? withAdvice(e) : new SyncError('server', 'Something went wrong. Try again.');
    await record(false, error.message, null);
    return { ok: false, error, bytes };
  }
}

function withAdvice(e: SyncError): SyncError {
  if (e.kind === 'conflict')
    return new SyncError('conflict', 'This data ID is already linked to another phone (for example after restoring a backup). Linking it to this phone needs the server’s recovery step; nothing was changed.', e.status);
  if (e.kind === 'auth') return new SyncError('auth', 'The server no longer accepts this phone’s key (it may have been revoked). Nothing was changed.', e.status);
  return e;
}

/** The owner's latest snapshot on the server, to look at. Never written into this phone's data. */
export async function inspectRemote(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid'>) {
  const userId = await ensureUserId(d.store, d.uuid);
  const cred = await credentialFor(d.secrets, userId);
  if (!cred) throw new SyncError('auth', 'Sync your data once to link this phone first.');
  return d.client.getSnapshot(cred);
}

/** Create a read-only link to exactly `payload` (what the preview showed). Needs a linked phone. */
export async function createShareLink(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid'>, scope: Scope, expiresInHours: 1 | 24, payload: HealthPayload) {
  const userId = await ensureUserId(d.store, d.uuid);
  const cred = await credentialFor(d.secrets, userId);
  if (!cred) throw new SyncError('auth', 'Sync your data once to link this phone first.');
  if (utf8Bytes(JSON.stringify(payload)) > MAX_UPLOAD_BYTES) throw new SyncError('tooLarge', 'That’s too much for one link. Choose a shorter period or fewer kinds of data.');
  return d.client.createShare(cred, scope, expiresInHours, payload);
}

export async function listShareLinks(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid'>) {
  const cred = await credentialFor(d.secrets, await ensureUserId(d.store, d.uuid));
  return cred ? d.client.listShares(cred) : [];
}

export async function revokeShareLink(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid'>, shareId: string) {
  const cred = await credentialFor(d.secrets, await ensureUserId(d.store, d.uuid));
  if (!cred) throw new SyncError('auth', 'This phone isn’t linked.');
  await d.client.revokeShare(cred, shareId);
}

/** The ready-to-send message for an AI: the instruction and the link. Never contains the owner token. */
export const aiInstruction = (url: string, expiresAt: string) =>
  `Read the JSON at this link and analyse my weight, waist, training and nutrition trends. Please identify the dates covered and any missing data.\n${url}\n(The link is read-only and expires ${expiresAt}.)`;
