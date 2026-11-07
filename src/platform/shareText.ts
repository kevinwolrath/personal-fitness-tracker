import { Share } from 'react-native';

/** What happened when sharing text (#76). Android's chooser can't report a dismissal, so it reads as "shared". */
export type ShareResult = 'shared' | 'dismissed' | 'copied' | 'unavailable';

/**
 * Share plain text through the system share sheet: on Android, ACTION_SEND with text/plain and the system chooser
 * (the user picks ChatGPT, Claude or any other app; no target is hard-coded). Never throws.
 */
export async function shareText(message: string, title: string): Promise<ShareResult> {
  try {
    const r = await Share.share({ message }, { dialogTitle: title, subject: title });
    return r.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return 'unavailable';
  }
}
