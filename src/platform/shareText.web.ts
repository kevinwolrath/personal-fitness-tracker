import * as Clipboard from 'expo-clipboard';
import type { ShareResult } from './shareText';

export type { ShareResult };

/** Web (the dev and test surface): the Web Share API when the browser has it, else copy to the clipboard. */
export async function shareText(message: string, title: string): Promise<ShareResult> {
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { share?: (d: ShareData) => Promise<void> }) : undefined;
  if (nav?.share) {
    try {
      await nav.share({ text: message, title });
      return 'shared';
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return 'dismissed';
    }
  }
  try {
    await Clipboard.setStringAsync(message);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}
