import * as Clipboard from 'expo-clipboard';

/**
 * Web (the dev and test surface) for meal photos (#97). There is no file system: each photo's data URI is kept in
 * localStorage under its own key, and the meal stores a short `pft-photo:<id>` reference. The draft is one more key.
 */

const PHOTO = 'pft:meal-photo:';
const DRAFT = 'pft:meal-draft';
const REF = 'pft-photo:';

const ls = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

async function toDataUri(uri: string): Promise<string> {
  if (uri.startsWith('data:')) return uri;
  const blob = await (await fetch(uri)).blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function keepPhoto(sourceUri: string, id: string): Promise<string> {
  const data = await toDataUri(sourceUri);
  const s = ls();
  if (!s) throw new Error('No storage');
  s.setItem(`${PHOTO}${id}`, data); // throws when storage is full: the caller reports it
  return `${REF}${id}`;
}

export function photoSource(uri: string): string | null {
  if (!uri.startsWith(REF)) return uri || null;
  return ls()?.getItem(`${PHOTO}${uri.slice(REF.length)}`) ?? null;
}

export async function photoExists(uri: string): Promise<boolean> {
  return photoSource(uri) !== null;
}

export async function deletePhoto(uri: string): Promise<void> {
  if (uri.startsWith(REF)) ls()?.removeItem(`${PHOTO}${uri.slice(REF.length)}`);
}

export async function loadDraft(): Promise<string | null> {
  return ls()?.getItem(DRAFT) ?? null;
}

export async function saveDraft(json: string): Promise<void> {
  ls()?.setItem(DRAFT, json);
}

export async function clearDraft(): Promise<void> {
  ls()?.removeItem(DRAFT);
}

export type PhotoShareResult = 'shared' | 'dismissed' | 'unavailable';

/** The Web Share API with the image file, where the browser can share files. */
export async function sharePhoto(uri: string, title: string): Promise<PhotoShareResult> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> }) : undefined;
  const data = photoSource(uri);
  if (!nav?.share || !nav.canShare || !data) return 'unavailable';
  try {
    const blob = await (await fetch(data)).blob();
    const file = new File([blob], 'meal.jpg', { type: blob.type || 'image/jpeg' });
    if (!nav.canShare({ files: [file] })) return 'unavailable';
    await nav.share({ files: [file], title });
    return 'shared';
  } catch (e) {
    return (e as { name?: string })?.name === 'AbortError' ? 'dismissed' : 'unavailable';
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

const PENDING = 'pft:meal-pending-share';
export async function loadPendingShare(): Promise<string | null> {
  return ls()?.getItem(PENDING) ?? null;
}
export async function savePendingShare(json: string): Promise<void> {
  ls()?.setItem(PENDING, json);
}
export async function clearPendingShare(): Promise<void> {
  ls()?.removeItem(PENDING);
}

/**
 * #183 on the web test surface: the Web Share API with the image and the text where the browser supports it. Tests
 * read `window.__pftLastShare` to check what was handed over (the photo and the prompt, together).
 */
export async function sharePhotoWithText(uri: string, text: string, title: string): Promise<PhotoShareResult> {
  if (typeof window !== 'undefined') (window as unknown as { __pftLastShare?: unknown }).__pftLastShare = { uri, text, title };
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { canShare?: (d: ShareData) => boolean; share?: (d: ShareData) => Promise<void> }) : undefined;
  const data = photoSource(uri);
  if (!nav?.share || !nav.canShare || !data) return 'shared';
  try {
    const blob = await (await fetch(data)).blob();
    const file = new File([blob], 'meal.jpg', { type: blob.type || 'image/jpeg' });
    if (!nav.canShare({ files: [file], text })) return 'shared';
    await nav.share({ files: [file], text, title });
    return 'shared';
  } catch (e) {
    return (e as { name?: string })?.name === 'AbortError' ? 'dismissed' : 'unavailable';
  }
}
