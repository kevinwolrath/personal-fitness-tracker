import { secrets } from './secrets';

/**
 * Device/app preferences: choices about this phone, never plan data (a plan change or Configure with AI can't
 * touch them). Stored with the same device storage as secrets (keystore natively, localStorage on web).
 */
const REMINDERS = 'pft.reminders.enabled';

export const preferences = {
  async remindersEnabled(): Promise<boolean> {
    return (await secrets.get(REMINDERS).catch(() => null)) === 'true';
  },
  async setRemindersEnabled(on: boolean): Promise<void> {
    await secrets.set(REMINDERS, on ? 'true' : 'false');
  },
};
