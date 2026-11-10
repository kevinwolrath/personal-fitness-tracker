import type { ShareResult } from '../../platform/shareText';
import { SharePreviewSheet } from '../../ui/SharePreviewSheet';

/**
 * "Share this day" preview (#76): the exact text, then Share. The text shown is the text shared (one string from
 * `dailySummary`), because weight and fitness records are sensitive. Cancel shares nothing.
 */
export function ShareDaySheet({ text, onClose, onResult, share }: {
  text: string;
  onClose: () => void;
  /** After a share attempt: the screen reports it (e.g. "Copied"). */
  onResult: (r: ShareResult) => void;
  /** The platform share; injectable for tests. */
  share?: (message: string, title: string) => Promise<ShareResult>;
}) {
  const includesWeight = /^Weight: /m.test(text);
  return (
    <SharePreviewSheet
      title="Share this day"
      text={text}
      intro={includesWeight ? 'This is exactly what will be shared. It includes your weight.' : 'This is exactly what will be shared.'}
      cancelLabel="Cancel sharing"
      onClose={onClose}
      onResult={onResult}
      share={share}
    />
  );
}
