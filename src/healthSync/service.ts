import type { LocalDate } from '../plan/dates';
import type { TrackingStore } from '../storage/types';
import { MAX_UPLOAD_BYTES, SyncError, type Credential, type HealthSyncClient, type Receipt, type ShareLink, type ShareScope } from './client';
import { databaseStart } from '../export/aiExport';
import { buildSnapshot, MAX_RECORDS, projectShare, utf8Bytes, type SyncSnapshot } from './payload';

/**
 * Health data sync (#134, #163), app side, against the deployed Worker (questspirestudio docs/body-anvil/SYNC_API.md).
 * Nothing here runs on its own: every upload, link and download is a tap.
 *
 * - **Data ID**: a random UUID v4 made once per install of the data, kept in the local database (`app_meta`), so a full
 *   backup (#128) carries it to a new phone. Sent in lowercase.
 * - **Owner token**: issued by the server when this phone first links; kept only in secure storage (keystore). Never in
 *   the database, a backup, an export, a log, a URL or a shared document. Stored with its data ID, so a token from a
 *   different ID (e.g. after restoring someone else's backup) is never used.
 * - **Retry key**: 32 random bytes as 64 lowercase hex, saved *before* the first link request, so an interrupted link
 *   can be retried and the server returns the same owner token instead of refusing the ID.
 * - **Enrollment key** (#136): a shared key built into the app (`EXPO_PUBLIC_BODY_ANVIL_ENROLLMENT_KEY`, see config.ts),
 *   passed in as `SyncDeps.enrollmentKey` and sent only as `X-Enrollment-Key` on the first link and its retries. Never
 *   asked of the user, stored, logged, or put in a snapshot or share. Linked phones don't need it.
 * - **Share links**: the server can't list them, so the phone keeps the ones it made (secure storage: each URL is a
 *   read credential) to show and revoke.
 */

/** #136 v1 stored a user-typed key here; keys now come from the build. Removed on sight, never read. */
export const LEGACY_ENROLLMENT_KEY = 'pft.healthSync.enrollmentKey';
/** #134 stored a user-typed server address here; the address now comes from the build (#146). Removed, never read. */
export const LEGACY_SERVER_URL = 'pft.healthSync.url';
/** Delete settings left by earlier user-entered designs (key, server address), if any. Never throws. */
export const forgetLegacySettings = (secrets: SecretStore) =>
  Promise.all([LEGACY_ENROLLMENT_KEY, LEGACY_SERVER_URL].map((k) => secrets.remove(k).catch(() => undefined))).then(() => undefined);

export const USER_ID_KEY = 'healthSync.userId';
export const SECRET_KEYS = {
  credential: 'pft.healthSync.credential',
  pending: 'pft.healthSync.pending',
  status: 'pft.healthSync.status',
  shares: 'pft.healthSync.shares',
} as const;

export const NO_ENROLLMENT_KEY = 'This version of the app isn’t set up to link to the server yet, so nothing was sent. Phones that are already linked keep syncing.';

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
  /** 32 random bytes as 64 lowercase hex characters (the Worker's retry-key format). */
  randomKey: () => string;
  /** #136: the build's enrollment key (config.ts), '' when this build has none. Sent only on enroll. */
  enrollmentKey: string;
  /** The device's IANA timezone (#171); the device's own when absent. */
  timezone?: string;
};

const deviceTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    return 'unknown';
  }
};
/** A link this phone made (the server can't list them). The URL is a read credential: secure storage only. */
export type SavedShare = ShareLink & { createdAt: string; range: ShareScope['range']; categories: ShareScope['categories'] };

const HEX64 = /^[0-9a-f]{64}$/;

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
/** The data ID as the Worker wants it (lowercase UUID v4). */
const wireId = async (store: TrackingStore, uuid: () => string) => (await ensureUserId(store, uuid)).toLowerCase();

/** The owner credential for this data ID, or null (never linked here, or a token belonging to another ID). */
export async function credentialFor(secrets: SecretStore, userId: string): Promise<Credential | null> {
  const c = await readJson<Credential>(secrets, SECRET_KEYS.credential);
  return c && c.userId.toLowerCase() === userId.toLowerCase() && typeof c.ownerToken === 'string' && HEX64.test(c.ownerToken) ? c : null;
}

export async function syncStatus(secrets: SecretStore): Promise<SyncStatus | null> {
  return readJson<SyncStatus>(secrets, SECRET_KEYS.status);
}

/** Everything this phone holds, as the upload snapshot, with its size. Reads only. */
export async function fullPayload(d: Pick<SyncDeps, 'store' | 'today' | 'appVersion' | 'now' | 'timezone'>): Promise<{ snapshot: SyncSnapshot; bytes: number }> {
  const snapshot = buildSnapshot(await d.store.snapshot(), {
    generatedAt: d.now(),
    timezone: d.timezone ?? deviceTimezone(),
    today: d.today,
    appVersion: d.appVersion,
    databaseStart: await databaseStart(d.store),
  });
  return { snapshot, bytes: utf8Bytes(JSON.stringify(snapshot)) };
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
    const userId = await wireId(d.store, d.uuid);
    const built = await fullPayload(d);
    bytes = built.bytes;
    const s = built.snapshot;
    if (bytes > MAX_UPLOAD_BYTES || [s.measurements, s.training.sessions, s.training.exercises].some((xs) => xs.length > MAX_RECORDS)) {
      throw new SyncError('tooLarge', 'That’s more data than one upload allows. Share a shorter period instead, or use Back up data.');
    }
    const cred = await credentialFor(d.secrets, userId);
    if (cred) {
      const receipt = await d.client.putSnapshot({ ...cred, userId }, built.snapshot);
      await record(true, 'Uploaded', receipt.updatedAt);
      return { ok: true, linked: false, receipt, bytes };
    }
    // First link: needs the build's enrollment key (#136). Without one, stop before sending anything.
    const key = d.enrollmentKey.trim();
    if (!key) throw new SyncError('config', NO_ENROLLMENT_KEY);
    // Reuse a saved retry key for this ID so a retry after an interruption is the same request.
    const saved = await readJson<{ userId: string; secret: string }>(d.secrets, SECRET_KEYS.pending);
    const pending = saved?.userId.toLowerCase() === userId && HEX64.test(saved.secret) ? saved : { userId, secret: d.randomKey() };
    if (pending !== saved) await d.secrets.set(SECRET_KEYS.pending, JSON.stringify(pending));
    const r = await d.client.enroll(userId, pending.secret, built.snapshot, key);
    await d.secrets.set(SECRET_KEYS.credential, JSON.stringify({ userId, ownerToken: r.ownerToken } satisfies Credential));
    await d.secrets.remove(SECRET_KEYS.pending).catch(() => undefined);
    const receipt: Receipt = { updatedAt: r.updatedAt, revision: r.revision, checksum: r.checksum };
    // A retried link returns the snapshot stored by the first attempt, never this one: upload this one now.
    const latest = r.created ? receipt : await d.client.putSnapshot({ userId, ownerToken: r.ownerToken }, built.snapshot).catch(() => receipt);
    await record(true, 'Linked and uploaded', latest.updatedAt);
    return { ok: true, linked: true, receipt: latest, bytes };
  } catch (e) {
    const error = e instanceof SyncError ? withAdvice(e) : new SyncError('server', 'Something went wrong. Try again.');
    await record(false, error.message, null);
    return { ok: false, error, bytes };
  }
}

function withAdvice(e: SyncError): SyncError {
  if (e.kind === 'conflict')
    return new SyncError('conflict', 'This data ID is already linked to another phone (for example after restoring a backup). Nothing was changed.', e.status);
  if (e.kind === 'auth') return new SyncError('auth', 'The server no longer accepts this phone’s key (it may have been replaced). Nothing was changed.', e.status);
  return e;
}

const linkedCredential = async (d: Pick<SyncDeps, 'store' | 'secrets' | 'uuid'>) => {
  const userId = await wireId(d.store, d.uuid);
  const cred = await credentialFor(d.secrets, userId);
  return cred ? { ...cred, userId } : null;
};

/** The owner's latest snapshot on the server, to look at. Never written into this phone's data. */
export async function inspectRemote(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid'>) {
  const cred = await linkedCredential(d);
  if (!cred) throw new SyncError('auth', 'Sync your data once to link this phone first.');
  return d.client.getSnapshot(cred);
}

export type SharePreview = { data: unknown; bytes: number; revision: string | null };

/**
 * Exactly what a link with this scope would share. Linked: the server's own projection of the last sync, with its
 * revision (a link can only be made from this). Not linked yet: the same projection worked out on the phone, for
 * "Share as text" only.
 */
export async function previewShare(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid' | 'today' | 'appVersion' | 'now' | 'timezone'>, scope: ShareScope): Promise<SharePreview> {
  const cred = await linkedCredential(d);
  if (cred) {
    const p = await d.client.previewShare(cred, scope);
    return { data: p.data, bytes: utf8Bytes(JSON.stringify(p.data)), revision: p.revision };
  }
  const data = projectShare((await fullPayload(d)).snapshot, scope);
  return { data, bytes: utf8Bytes(JSON.stringify(data)), revision: null };
}

/** Create a read-only link to exactly the previewed data (`revision` from previewShare). Remembered on this phone. */
export async function createShareLink(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid' | 'now'>, scope: ShareScope, revision: string): Promise<SavedShare> {
  const cred = await linkedCredential(d);
  if (!cred) throw new SyncError('auth', 'Sync your data once to link this phone first.');
  const link = await d.client.createShare(cred, scope, revision);
  const saved: SavedShare = { ...link, createdAt: d.now(), range: scope.range, categories: scope.categories };
  await d.secrets.set(SECRET_KEYS.shares, JSON.stringify([saved, ...(await savedShares(d.secrets))].slice(0, 20))).catch(() => undefined);
  return saved;
}

const savedShares = async (secrets: SecretStore) => (await readJson<SavedShare[]>(secrets, SECRET_KEYS.shares)) ?? [];

/** Links this phone made that haven't expired, newest first. */
export async function listShareLinks(d: Pick<SyncDeps, 'secrets' | 'now'>): Promise<SavedShare[]> {
  const now = d.now();
  return (await savedShares(d.secrets)).filter((s) => s.expiresAt > now);
}

export async function revokeShareLink(d: Pick<SyncDeps, 'store' | 'client' | 'secrets' | 'uuid'>, shareId: string) {
  const cred = await linkedCredential(d);
  if (!cred) throw new SyncError('auth', 'This phone isn’t linked.');
  await d.client.revokeShare(cred, shareId).catch((e) => {
    if (!(e instanceof SyncError && e.kind === 'notFound')) throw e; // already gone
  });
  await d.secrets.set(SECRET_KEYS.shares, JSON.stringify((await savedShares(d.secrets)).filter((s) => s.id !== shareId))).catch(() => undefined);
}

/** #168: everything, all history, every category, 24 hours. */
export const EVERYTHING: Omit<ShareScope, 'format'> = { range: 'all', categories: ['measurements', 'activity', 'sleep', 'nutrition', 'training', 'plan'], expiresIn: 24 * 3600 };

export type EverythingResult = { link: SavedShare; format: ShareScope['format']; receipt: Receipt };

/**
 * Share everything (#168): one tap. Syncs first, so the link is the phone's current data; makes no link if the sync
 * fails (never a stale link). Then shares all history and every category for 24 hours. When that is more than one link
 * can hold (the Worker's share limit), it shares the Worker's per-metric summary of all history instead of cutting the
 * period. Throws a SyncError the sheet shows.
 */
export async function shareEverything(d: SyncDeps, onStage: (stage: 'sync' | 'link') => void = () => undefined): Promise<EverythingResult> {
  onStage('sync');
  const sync = await syncNow(d);
  if (!sync.ok) throw new SyncError(sync.error.kind, `Your server copy couldn’t be updated, so no link was made. ${sync.error.message}`, sync.error.status, sync.error.retryAfterSeconds);
  const cred = await linkedCredential(d);
  if (!cred) throw new SyncError('auth', 'Sync your data once to link this phone first.');
  onStage('link');
  let scope: ShareScope = { ...EVERYTHING, format: 'records' };
  let preview;
  try {
    preview = await d.client.previewShare(cred, scope);
  } catch (e) {
    if (!(e instanceof SyncError && e.kind === 'tooLarge')) throw e;
    scope = { ...EVERYTHING, format: 'summary' };
    preview = await d.client.previewShare(cred, scope);
  }
  return { link: await createShareLink(d, scope, preview.revision), format: scope.format, receipt: sync.receipt };
}

/** The message for the share sheet: the AI instruction, saying when the link is a summary. */
export const everythingMessage = (r: Pick<EverythingResult, 'link' | 'format'>) =>
  r.format === 'summary'
    ? `${aiInstruction(r.link.url, r.link.expiresAt)}\n(My full history is too long for one link, so this is a summary per measurement over all of it: count, average, lowest, highest, first and latest.)`
    : aiInstruction(r.link.url, r.link.expiresAt);

/** The ready-to-send message for an AI: the instruction and the link. Never contains the owner token. */
export const aiInstruction = (url: string, expiresAt: string) =>
  `Read the JSON at this link and analyse my weight, waist, training and nutrition trends. Start with its readMe, coverage and database fields: they say which dates the app's records and Health Connect cover, so days outside that aren't missed logging. Then identify the dates covered and any missing data.\n${url}\n(The link is read-only and expires ${expiresAt}.)`;
