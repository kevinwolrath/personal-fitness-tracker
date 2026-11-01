import * as Haptics from 'expo-haptics';

/** Light confirmation tap (contract 02). See haptics.web.ts. */
export function tap(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}
