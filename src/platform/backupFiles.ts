import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { BackupIO } from '../backup/service';
import { secrets } from './secrets';

/**
 * Native side of backup and restore (#128): attachments are files in the app's private document directory (meal
 * photos, retained import screenshots), preferences are in the keystore. Restored attachments go to new folders
 * (`meal-photos/restore-<id>/`, `imports/restore-<id>/`) so nothing existing is overwritten until the restore has
 * succeeded.
 */
export const backupIO: BackupIO = {
  async readAttachment(uri) {
    try {
      const f = new File(uri);
      return f.exists ? await f.bytes() : null;
    } catch {
      return null;
    }
  },
  async writeAttachment(restoreId, path, bytes) {
    const [, kind, ...rest] = path.split('/'); // attachments/<meal-photos|imports>/…
    const dir = new Directory(Paths.document, kind, `restore-${restoreId}`, ...rest.slice(0, -1));
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, rest[rest.length - 1]);
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    return file.uri;
  },
  async removeAttachments(uris) {
    for (const uri of uris) {
      try {
        const f = new File(uri);
        if (f.exists) f.delete();
      } catch {
        // An unused file left behind is harmless.
      }
    }
  },
  async freeBytes() {
    try {
      return Paths.availableDiskSpace;
    } catch {
      return null;
    }
  },
  getPreference: (key) => secrets.get(key),
  setPreference: async (key, value) => {
    if (value === null) await secrets.remove(key);
    else await secrets.set(key, value);
  },
};

/** The Android document picker (Files, Drive, Downloads…) or the iOS Files picker. Null when cancelled. */
export async function pickBackupFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], copyToCacheDirectory: true, multiple: false });
  if (r.canceled || !r.assets?.[0]) return null;
  const asset = r.assets[0];
  const file = new File(asset.uri);
  try {
    return { name: asset.name, bytes: await file.bytes() };
  } finally {
    try {
      file.delete(); // the picker's cache copy
    } catch {
      // ignore
    }
  }
}

/** Save through the system share sheet (Files, Drive, email, nearby share…). The temporary copy is removed after. */
export async function saveBackupFile(name: string, bytes: Uint8Array): Promise<'shared' | 'unavailable'> {
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/zip', dialogTitle: name, UTI: 'public.zip-archive' });
    return 'shared';
  } finally {
    try {
      file.delete();
    } catch {
      // ignore
    }
  }
}
