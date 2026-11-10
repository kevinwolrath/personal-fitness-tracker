import type { BackupIO } from '../backup/service';
import { secrets } from './secrets';

/**
 * Web (the dev and test surface) side of backup and restore (#128). Meal photos live in localStorage as data URIs
 * under `pft:meal-photo:<id>` with records pointing at `pft-photo:<id>` (see mealPhotos.web.ts); restored ones get
 * new ids, so nothing existing is overwritten until the restore has succeeded.
 */
const PHOTO = 'pft:meal-photo:';
const REF = 'pft-photo:';
const ls = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};
const mimeOf = (path: string) => (/\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : /\.heic$/i.test(path) ? 'image/heic' : 'image/jpeg');

function fromDataUri(data: string): Uint8Array | null {
  const m = data.match(/^data:[^;,]*(;base64)?,(.*)$/s);
  if (!m) return null;
  if (!m[1]) return new TextEncoder().encode(decodeURIComponent(m[2]));
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toDataUri(bytes: Uint8Array, mime: string): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

export const backupIO: BackupIO = {
  async readAttachment(uri) {
    const data = uri.startsWith(REF) ? ls()?.getItem(`${PHOTO}${uri.slice(REF.length)}`) : uri.startsWith('data:') ? uri : null;
    return data ? fromDataUri(data) : null;
  },
  async writeAttachment(restoreId, path, bytes) {
    const s = ls();
    if (!s) throw new Error('No storage');
    const id = `r${restoreId}-${path.replace(/^attachments\//, '').replace(/[^A-Za-z0-9_-]/g, '_')}`;
    s.setItem(`${PHOTO}${id}`, toDataUri(bytes, mimeOf(path))); // throws QuotaExceededError when storage is full
    return `${REF}${id}`;
  },
  async removeAttachments(uris) {
    for (const u of uris) if (u.startsWith(REF)) ls()?.removeItem(`${PHOTO}${u.slice(REF.length)}`);
  },
  async freeBytes() {
    return null; // unknown in a browser: a full localStorage fails the write, and the restore rolls back
  },
  getPreference: (key) => secrets.get(key),
  setPreference: async (key, value) => {
    if (value === null) await secrets.remove(key);
    else await secrets.set(key, value);
  },
};

/** A file input: the browser's own file chooser. Null when cancelled. */
export function pickBackupFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.style.display = 'none';
    input.onchange = async () => {
      const f = input.files?.[0];
      input.remove();
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.addEventListener('cancel', () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/** Download the file. */
export async function saveBackupFile(name: string, bytes: Uint8Array): Promise<'shared' | 'unavailable'> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'shared';
}
