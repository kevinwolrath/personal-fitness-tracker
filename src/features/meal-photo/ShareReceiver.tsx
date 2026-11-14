import { router } from 'expo-router';
import { useShareIntent } from 'expo-share-intent';
import { useEffect } from 'react';

/**
 * #183: text shared TO Body Anvil from any app (an AI's meal block, via Android's share sheet) opens the return page.
 * Rendered in the app shell, so the navigator is ready: cold start (the app opened by the share) and a share into the
 * running app both arrive here. The native intent is cleared once handled, so it opens once. Text only; anything else
 * shared is ignored. Disabled on the web (no share target there).
 */
export function ShareReceiver() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();
  useEffect(() => {
    if (!hasShareIntent) return;
    const text = typeof shareIntent.text === 'string' ? shareIntent.text.slice(0, 20_000) : '';
    resetShareIntent();
    if (text.trim()) router.push({ pathname: '/meal-return', params: { text } });
  }, [hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
