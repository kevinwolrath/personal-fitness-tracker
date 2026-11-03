import { isEnergyDisplay, type EnergyDisplay } from '../energy';
import { secrets } from './secrets';

/**
 * Device/app preferences: choices about this phone, never plan data (a plan change or Configure with AI can't
 * touch them). Stored with the same device storage as secrets (keystore natively, localStorage on web).
 */
const REMINDERS = 'pft.reminders.enabled';
const ENERGY = 'pft.display.energy';

export const preferences = {
  async remindersEnabled(): Promise<boolean> {
    return (await secrets.get(REMINDERS).catch(() => null)) === 'true';
  },
  async setRemindersEnabled(on: boolean): Promise<void> {
    await secrets.set(REMINDERS, on ? 'true' : 'false');
  },
  /** How energy is shown (#39). Null until the user picks one: the app then shows the plan's own unit. */
  async energyDisplay(): Promise<EnergyDisplay | null> {
    const v = await secrets.get(ENERGY).catch(() => null);
    return isEnergyDisplay(v) ? v : null;
  },
  async setEnergyDisplay(d: EnergyDisplay): Promise<void> {
    await secrets.set(ENERGY, d);
  },
};
