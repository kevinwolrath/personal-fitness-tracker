import { BACKUP_PREFERENCE_KEYS } from '../platform/preferences';
import type { LocalDate } from '../plan/dates';
import type { StoreSnapshot, TrackingStore } from '../storage/types';
import { ATTACHMENT_REF, attachmentsOf, hasExtension, sniffExtension, buildBackup, readBackup, remapAttachments, type Attachment, type BackupManifest } from './archive';

/** Device side of backup and restore. Native: app files and keystore; web: localStorage. Injected for tests. */
export type BackupIO = {
  /** Bytes of a stored attachment, or null when the file is missing. */
  readAttachment(uri: string): Promise<Uint8Array | null>;
  /**
   * Write one restored attachment to a NEW location for this restore (never over an existing file), and return its
   * URI. Throws on failure (e.g. storage full).
   */
  writeAttachment(restoreId: string, path: string, bytes: Uint8Array): Promise<string>;
  /** Delete attachments. Never throws: used for rollback and for cleaning up the replaced files. */
  removeAttachments(uris: string[]): Promise<void>;
  /** Free bytes on the device, or null when unknown (web). */
  freeBytes(): Promise<number | null>;
  getPreference(key: string): Promise<string | null>;
  setPreference(key: string, value: string | null): Promise<void>;
};

export const EXCLUDED_FROM_BACKUP = [
  'Health Connect permissions and sync state: connect again; the next sync re-reads recent days without duplicating them.',
  'Notification permission: allow it again if you use reminders.',
  'Anything belonging only to this phone (an unfinished setup, app version, device identifiers).',
];

export type Progress = (step: string) => void;

/** Read everything and build the archive. Nothing is changed. */
export async function createBackup(store: TrackingStore, io: BackupIO, meta: { createdAt: string; today: LocalDate; appVersion: string }, progress: Progress = () => undefined) {
  progress('Reading your records…');
  const snapshot = await store.snapshot();
  const preferences: Record<string, string> = {};
  for (const key of BACKUP_PREFERENCE_KEYS.included) {
    const v = await io.getPreference(key).catch(() => null);
    if (v !== null && v !== undefined) preferences[key] = v;
  }
  const refs = attachmentsOf(snapshot);
  const files: { uri: string; path: string; bytes: Uint8Array | null }[] = [];
  for (let i = 0; i < refs.length; i++) {
    progress(`Adding photos and screenshots (${i + 1} of ${refs.length})…`);
    const bytes = await io.readAttachment(refs[i].uri).catch(() => null);
    // A reference without an extension (web) gets the type its bytes really are, so it comes back the same.
    const path = bytes && !hasExtension(refs[i].uri) ? refs[i].path.replace(/\.[a-z0-9]+$/, `.${sniffExtension(bytes)}`) : refs[i].path;
    files.push({ uri: refs[i].uri, path, bytes });
  }
  progress('Packing the backup…');
  return buildBackup({ snapshot, preferences, files, meta: { ...meta, excluded: EXCLUDED_FROM_BACKUP } });
}

export type RestorePreview = Extract<ReturnType<typeof readBackup>, { ok: true }>;

/** Validate a picked file completely. Nothing is changed. */
export function previewBackup(bytes: Uint8Array): ReturnType<typeof readBackup> {
  return readBackup(bytes);
}

/** Space a restore needs: the attachments plus the records, with headroom. */
export function spaceNeeded(m: BackupManifest): number {
  const bytes = m.files.reduce((n, f) => n + f.size, 0);
  return Math.ceil(bytes * 1.2) + 20 * 1024 * 1024;
}

export type RestoreResult = { ok: true; manifest: BackupManifest } | { ok: false; error: string; rolledBack: boolean };

/**
 * Replace all data on this device with a validated backup, atomically:
 * 1. check free space;
 * 2. remember the current data and preferences (for rollback);
 * 3. write the backup's attachments to new locations (nothing existing is overwritten);
 * 4. replace the store in one transaction, then the preferences;
 * 5. only then delete the old attachments.
 * Any failure in 3–4 undoes everything: the store and preferences go back to what they were and the new files are
 * removed, so the phone is never left with partial data.
 */
export async function restoreBackup(store: TrackingStore, io: BackupIO, backup: RestorePreview, opts: { restoreId: string; progress?: Progress }): Promise<RestoreResult> {
  const progress = opts.progress ?? (() => undefined);
  const free = await io.freeBytes().catch(() => null);
  const need = spaceNeeded(backup.manifest);
  if (free !== null && free < need) {
    return { ok: false, rolledBack: false, error: `Not enough free storage to restore: it needs about ${mb(need)} and ${mb(free)} is free. Free up space and try again. Nothing was changed.` };
  }

  progress('Keeping a copy of your current data…');
  const before: StoreSnapshot = await store.snapshot();
  const prefsBefore: Record<string, string | null> = {};
  for (const key of BACKUP_PREFERENCE_KEYS.included) prefsBefore[key] = await io.getPreference(key).catch(() => null);

  const written: string[] = [];
  let storeReplaced = false;
  let prefsTouched = false;
  try {
    const uriFor = new Map<string, string>();
    const atts: Attachment[] = backup.attachments;
    for (let i = 0; i < atts.length; i++) {
      progress(`Restoring photos and screenshots (${i + 1} of ${atts.length})…`);
      const uri = await io.writeAttachment(opts.restoreId, atts[i].path, atts[i].bytes);
      written.push(uri);
      uriFor.set(atts[i].path, uri);
    }
    const restored = remapAttachments(backup.snapshot, (uri) => (uri.startsWith(ATTACHMENT_REF) ? uriFor.get(uri.slice(ATTACHMENT_REF.length)) ?? uri : uri));

    progress('Restoring your records…');
    // Marked before the call: if it fails part-way (or after writing), putting the old data back is always safe.
    storeReplaced = true;
    await store.replaceAll(restored);

    progress('Restoring your preferences…');
    prefsTouched = true;
    // Replace, not merge: a preference the backup doesn't have goes back to its default.
    for (const key of BACKUP_PREFERENCE_KEYS.included) await io.setPreference(key, backup.preferences[key] ?? null);
  } catch (e) {
    progress('Something went wrong. Putting your data back…');
    let rolledBack = true;
    try {
      if (storeReplaced) await store.replaceAll(before);
      if (prefsTouched) for (const [key, value] of Object.entries(prefsBefore)) await io.setPreference(key, value);
    } catch {
      rolledBack = false;
    }
    await io.removeAttachments(written);
    const why = e instanceof Error && /quota|space|full/i.test(e.message) ? ' The phone ran out of storage.' : '';
    return {
      ok: false,
      rolledBack,
      error: rolledBack
        ? `The restore couldn't be completed, so your previous data was kept unchanged.${why}`
        : `The restore failed and your previous data couldn't be fully put back.${why} Restore again from the same backup file.`,
    };
  }

  // Success: the old attachments are no longer referenced. A failure here only leaves unused files behind.
  progress('Tidying up…');
  const keep = new Set(written);
  await io.removeAttachments(attachmentsOf(before).map((a) => a.uri).filter((u) => !keep.has(u)));
  return { ok: true, manifest: backup.manifest };
}

const mb = (bytes: number) => `${Math.max(0.1, Math.round((bytes / 1024 / 1024) * 10) / 10)} MB`;
