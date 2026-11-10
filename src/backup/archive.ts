import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import { buildExport, toSnapshot, type ExportDocument } from '../export/exportFormat';
import type { LocalDate } from '../plan/dates';
import type { StoreSnapshot } from '../storage/types';
import { sha256 } from './sha256';

/**
 * Full offline backup (#128): ONE portable ZIP with a manifest, the whole store, device preferences and every
 * attachment (meal photos, retained import screenshots) as original bytes. Pure: no I/O here.
 *
 *   manifest.json             format, backupVersion, app, createdAt, counts, every file with size + SHA-256
 *   data/store.json           the full-history export (contract 06, #5) of the whole store
 *   data/preferences.json     app-owned device preferences (BACKUP_PREFERENCE_KEYS.included)
 *   attachments/meal-photos/<photoId>.<ext>
 *   attachments/imports/<importId>/<assetId>.<ext>
 *
 * Attachment URIs in the store are device paths, so in the archive they are rewritten to `attachment:<path>` and
 * mapped back to new local URIs on restore.
 */

export const BACKUP_FORMAT = 'body-anvil-backup';
/**
 * Compatibility policy: a backup made by any app version with backupVersion ≤ this one is readable; older versions
 * are upgraded by `migrateManifest` (and the store by the export format's own defaults). A newer backupVersion is
 * refused with "update the app" and nothing is changed.
 */
export const BACKUP_VERSION = 1;
export const ATTACHMENT_REF = 'attachment:';

/** Hard limits against malicious archives (zip bombs, absurd file counts). Real backups stay far below them. */
export const LIMITS = { files: 50_000, fileBytes: 200 * 1024 * 1024, totalBytes: 4 * 1024 * 1024 * 1024 } as const;

const SAFE_PATH = /^(manifest\.json|data\/(store|preferences)\.json|attachments\/(meal-photos\/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,5}|imports\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\.[a-z0-9]{1,5}))$/;
/** Only plain, known paths: no `..`, absolute paths, backslashes, hidden files or other folders. */
export const isSafePath = (p: string) => SAFE_PATH.test(p) && !p.includes('..');

const fileEntry = z.strictObject({ path: z.string(), size: z.number().int().nonnegative(), sha256: z.string().regex(/^[0-9a-f]{64}$/) });
export const manifestSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  backupVersion: z.number().int().positive(),
  createdAt: z.string(),
  app: z.object({ name: z.string(), version: z.string() }),
  range: z.object({ from: z.string().nullable(), to: z.string() }),
  counts: z.record(z.string(), z.number()),
  files: z.array(fileEntry).max(LIMITS.files),
  /** Attachments referenced by records whose file was already missing on the phone when the backup was made. */
  missingAttachments: z.array(z.string()).default([]),
  /** What a backup never contains, in words, for the preview. */
  excluded: z.array(z.string()).default([]),
});
export type BackupManifest = z.infer<typeof manifestSchema>;

export type Attachment = { path: string; bytes: Uint8Array };
/** A stored attachment: where it lives on this device, and where it goes in the archive. */
export type AttachmentRef = { uri: string; path: string };

/** The image type from its first bytes, for attachments whose URI has no extension (web references). */
export function sniffExtension(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'heic';
  return 'jpg';
}
export const hasExtension = (uri: string) => /\.([a-z0-9]{1,5})(?:\?|$)/i.test(uri) && !uri.startsWith('data:');

const ext = (uri: string, fallback: string) => (uri.match(/\.([a-z0-9]{1,5})(?:\?|$)/i)?.[1] ?? fallback).toLowerCase();
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'x';

/** Every attachment the store references, with its archive path. Pure. */
export function attachmentsOf(s: StoreSnapshot): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  const seen = new Set<string>();
  const add = (uri: string, path: string) => {
    if (!uri || uri.startsWith(ATTACHMENT_REF) || seen.has(path)) return;
    seen.add(path);
    out.push({ uri, path });
  };
  for (const m of s.mealLogs ?? []) for (const p of m.photos) add(p.uri, `attachments/meal-photos/${safeId(p.id)}.${ext(p.uri, 'jpg')}`);
  for (const i of s.imports) for (const a of i.assets) if (a.storedUri) add(a.storedUri, `attachments/imports/${safeId(i.id)}/${safeId(a.id)}.${ext(a.storedUri, a.mimeType?.includes('png') ? 'png' : 'jpg')}`);
  return out;
}

/** Rewrite attachment URIs through `map` (device → archive refs, or archive refs → new device URIs). Pure. */
export function remapAttachments(s: StoreSnapshot, map: (uri: string) => string): StoreSnapshot {
  return {
    ...s,
    mealLogs: (s.mealLogs ?? []).map((m) => ({ ...m, photos: m.photos.map((p) => ({ ...p, uri: map(p.uri) })) })),
    imports: s.imports.map((i) => ({ ...i, assets: i.assets.map((a) => ({ ...a, storedUri: a.storedUri ? map(a.storedUri) : a.storedUri })) })),
  };
}

export type BuildInput = {
  snapshot: StoreSnapshot;
  preferences: Record<string, string>;
  /** Bytes of each attachment from `attachmentsOf`, or null when the file is missing on the phone. */
  files: (AttachmentRef & { bytes: Uint8Array | null })[];
  meta: { createdAt: string; today: LocalDate; appVersion: string; excluded: string[] };
};

/** Build the archive. Pure: returns the ZIP bytes, the manifest and the suggested file name. */
export function buildBackup(input: BuildInput): { bytes: Uint8Array; manifest: BackupManifest; fileName: string } {
  const present = new Map(input.files.filter((f) => f.bytes).map((f) => [f.uri, f.path]));
  const missing = input.files.filter((f) => !f.bytes).map((f) => f.path);
  // Records keep their link: an attachment ref when the file is in the archive, the old URI when it was missing.
  const portable = remapAttachments(input.snapshot, (uri) => (present.has(uri) ? `${ATTACHMENT_REF}${present.get(uri)}` : uri));
  const doc = buildExport(portable, { exportedAt: input.meta.createdAt, today: input.meta.today, appVersion: input.meta.appVersion });
  const entries: Record<string, Uint8Array> = {
    'data/store.json': strToU8(JSON.stringify(doc)),
    'data/preferences.json': strToU8(JSON.stringify(input.preferences)),
  };
  for (const f of input.files) if (f.bytes) entries[f.path] = f.bytes;
  const files = Object.entries(entries).map(([path, bytes]) => ({ path, size: bytes.length, sha256: sha256(bytes) }));
  const photos = input.files.filter((f) => f.bytes && f.path.startsWith('attachments/meal-photos/')).length;
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    createdAt: input.meta.createdAt,
    app: { name: 'Body Anvil', version: input.meta.appVersion },
    range: doc.range,
    counts: {
      ...doc.counts,
      planVersions: doc.plans.length + doc.configChanges.length,
      preferences: Object.keys(input.preferences).length,
      mealPhotos: photos,
      importAssets: input.files.filter((f) => f.bytes).length - photos,
      bytes: files.reduce((n, f) => n + f.size, 0),
    },
    files,
    missingAttachments: missing,
    excluded: input.meta.excluded,
  };
  const zippable: Zippable = { 'manifest.json': [strToU8(JSON.stringify(manifest, null, 2)), { level: 6 }] };
  // Photos are already compressed: store them as they are (faster, same size).
  for (const [path, bytes] of Object.entries(entries)) zippable[path] = [bytes, { level: path.startsWith('attachments/') ? 0 : 6 }];
  return { bytes: zipSync(zippable, { mtime: new Date('2000-01-01T00:00:00Z') }), manifest, fileName: `body-anvil-backup-${input.meta.today}.zip` };
}

export type ReadBackup =
  | { ok: true; manifest: BackupManifest; snapshot: StoreSnapshot; preferences: Record<string, string>; attachments: Attachment[]; store: ExportDocument }
  | { ok: false; error: string };

const fail = (error: string): ReadBackup => ({ ok: false, error });

/** Older backup versions are upgraded here, one step at a time. Version 1 is current. */
function migrateManifest(m: BackupManifest): BackupManifest {
  return m;
}

/**
 * Read and fully validate an archive before anything is changed: ZIP structure, safe paths, sizes, manifest,
 * version, every checksum, the store's schema and every attachment reference. Pure.
 */
export function readBackup(bytes: Uint8Array): ReadBackup {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return fail("This isn't a Body Anvil backup (not a ZIP file). Choose the .zip file that Back up data saved.");
  // Inspect names and sizes first, without inflating anything (zip-bomb and path-traversal safe).
  const listed: { name: string; originalSize: number }[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        listed.push({ name: f.name, originalSize: f.originalSize });
        return false;
      },
    });
  } catch {
    return fail('This backup file is damaged or incomplete (the ZIP could not be read). If it was copied or downloaded, try that again.');
  }
  if (listed.length > LIMITS.files) return fail('This backup has too many files to be a Body Anvil backup.');
  const unsafe = listed.find((f) => !isSafePath(f.name));
  if (unsafe) return fail(`This backup contains an unexpected file ("${unsafe.name.slice(0, 80)}"), so it was not restored. Use a backup made by Body Anvil.`);
  if (new Set(listed.map((f) => f.name)).size !== listed.length) return fail('This backup lists a file twice, so it was not restored.');
  if (listed.some((f) => f.originalSize > LIMITS.fileBytes) || listed.reduce((n, f) => n + f.originalSize, 0) > LIMITS.totalBytes) {
    return fail('This backup is larger than Body Anvil can restore.');
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    return fail('This backup file is damaged or incomplete (a file inside could not be read). If it was copied or downloaded, try that again.');
  }
  if (!files['manifest.json']) return fail("This ZIP has no backup manifest, so it isn't a Body Anvil backup.");
  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    return fail('The backup manifest is damaged.');
  }
  const head = z.object({ format: z.literal(BACKUP_FORMAT), backupVersion: z.number().int().positive() }).safeParse(manifestJson);
  if (!head.success) return fail("This file isn't a Body Anvil backup.");
  if (head.data.backupVersion > BACKUP_VERSION) {
    return fail(`This backup was made by a newer version of Body Anvil (backup format ${head.data.backupVersion}). Update the app, then restore it. Nothing was changed.`);
  }
  const parsed = manifestSchema.safeParse(manifestJson);
  if (!parsed.success) return fail('The backup manifest is damaged or incomplete.');
  const manifest = migrateManifest(parsed.data);

  // Every listed file is present with the right size and checksum; nothing unlisted is present.
  const expected = new Set(manifest.files.map((f) => f.path));
  for (const f of manifest.files) {
    if (!isSafePath(f.path)) return fail(`The backup manifest lists an unsafe path ("${f.path.slice(0, 80)}").`);
    const b = files[f.path];
    if (!b) return fail(`The backup is missing ${describe(f.path)}. It may be incomplete; make a new backup on the old phone if you can.`);
    if (b.length !== f.size || sha256(b) !== f.sha256) return fail(`${capital(describe(f.path))} in this backup is damaged (its checksum doesn't match). Nothing was changed.`);
  }
  const extra = Object.keys(files).find((p) => p !== 'manifest.json' && !expected.has(p));
  if (extra) return fail(`This backup contains a file its manifest doesn't list ("${extra.slice(0, 80)}"), so it was not restored.`);

  let storeJson: unknown, preferences: unknown;
  try {
    storeJson = JSON.parse(strFromU8(files['data/store.json']));
    preferences = JSON.parse(strFromU8(files['data/preferences.json']));
  } catch {
    return fail('The data inside this backup is damaged.');
  }
  const store = toSnapshot(storeJson);
  if (!store.ok) return fail(`The data inside this backup isn't valid (${store.error}). Nothing was changed.`);
  const prefs = z.record(z.string(), z.string()).safeParse(preferences);
  if (!prefs.success) return fail('The preferences inside this backup are damaged.');

  // Every attachment a record points to is in the archive.
  const attachments = manifest.files.filter((f) => f.path.startsWith('attachments/')).map((f) => ({ path: f.path, bytes: files[f.path] }));
  const have = new Set(attachments.map((a) => a.path));
  for (const { uri } of attachmentsOfRefs(store.snapshot)) {
    const path = uri.slice(ATTACHMENT_REF.length);
    if (!have.has(path)) return fail(`A record points to ${describe(path)}, which isn't in this backup. Nothing was changed.`);
  }
  return { ok: true, manifest, snapshot: store.snapshot, preferences: prefs.data, attachments, store: storeJson as ExportDocument };
}

/** Attachment refs (`attachment:…`) the records point to. */
function attachmentsOfRefs(s: StoreSnapshot): { uri: string }[] {
  const out: { uri: string }[] = [];
  for (const m of s.mealLogs ?? []) for (const p of m.photos) if (p.uri.startsWith(ATTACHMENT_REF)) out.push({ uri: p.uri });
  for (const i of s.imports) for (const a of i.assets) if (a.storedUri?.startsWith(ATTACHMENT_REF)) out.push({ uri: a.storedUri });
  return out;
}

const describe = (path: string) =>
  path === 'data/store.json' ? 'the records file' : path === 'data/preferences.json' ? 'the preferences file' : path.startsWith('attachments/meal-photos/') ? 'a meal photo' : path.startsWith('attachments/imports/') ? 'an imported screenshot' : `"${path}"`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
