import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

/**
 * Meal photos and the wizard draft on the phone (#97, contract 15). Photos are copied into the app's private
 * document directory (permanent, not the cache, never uploaded by the app) and are only deleted when the user
 * deletes them (or cancels a draft that added them). The draft is a small JSON file next to them, so the wizard
 * resumes after the app is backgrounded, killed or restarted.
 */

const dir = () => (FileSystem.documentDirectory ? `${FileSystem.documentDirectory}meal-photos/` : null);
const DRAFT = 'draft.json';

async function ensureDir(): Promise<string> {
  const d = dir();
  if (!d) throw new Error('No app storage');
  await FileSystem.makeDirectoryAsync(d, { intermediates: true }).catch(() => undefined);
  return d;
}

/** Copy a picked or captured image into permanent app-private storage. Returns its URI. */
export async function keepPhoto(sourceUri: string, id: string): Promise<string> {
  const d = await ensureDir();
  const ext = (sourceUri.match(/\.(jpe?g|png|webp|heic)(\?|$)/i)?.[1] ?? 'jpg').toLowerCase();
  const to = `${d}${id}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to });
  return to;
}

/** What an <Image> can show for a stored photo. */
export function photoSource(uri: string): string | null {
  return uri || null;
}

export async function photoExists(uri: string): Promise<boolean> {
  try {
    return (await FileSystem.getInfoAsync(uri)).exists;
  } catch {
    return false;
  }
}

export async function deletePhoto(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
}

export async function loadDraft(): Promise<string | null> {
  const d = dir();
  if (!d) return null;
  try {
    return await FileSystem.readAsStringAsync(`${d}${DRAFT}`);
  } catch {
    return null;
  }
}

export async function saveDraft(json: string): Promise<void> {
  const d = await ensureDir();
  await FileSystem.writeAsStringAsync(`${d}${DRAFT}`, json);
}

export async function clearDraft(): Promise<void> {
  const d = dir();
  if (d) await FileSystem.deleteAsync(`${d}${DRAFT}`, { idempotent: true }).catch(() => undefined);
}

export type PhotoShareResult = 'shared' | 'dismissed' | 'unavailable';

/**
 * Share one photo through the system share sheet (Android ACTION_SEND with the image; the user picks ChatGPT,
 * Claude or any app). expo-sharing sends a file only, never text with it: the caller copies the prompt first.
 */
export async function sharePhoto(uri: string, title: string): Promise<PhotoShareResult> {
  try {
    if (!(await Sharing.isAvailableAsync())) return 'unavailable';
    const mimeType = /\.png$/i.test(uri) ? 'image/png' : /\.webp$/i.test(uri) ? 'image/webp' : 'image/jpeg';
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: title, UTI: mimeType === 'image/png' ? 'public.png' : 'public.jpeg' });
    return 'shared';
  } catch {
    return 'unavailable';
  }
}


export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false;
  }
}

export async function readClipboard(): Promise<string | null> {
  try {
    return (await Clipboard.getStringAsync()) || null;
  } catch {
    return null;
  }
}
