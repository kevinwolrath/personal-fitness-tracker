import { isEnergyDisplay, type EnergyDisplay } from '../energy';
import type { HcTypeResult } from '../observations/healthConnect';
import { secrets } from './secrets';

/**
 * Device/app preferences: choices about this phone, never plan data (a plan change or Configure with AI can't
 * touch them). Stored with the same device storage as secrets (keystore natively, localStorage on web).
 */
const REMINDERS = 'pft.reminders.enabled';
const ENERGY = 'pft.display.energy';
const HC_SYNC = 'pft.healthConnect.sync';
const SETUP_DRAFT = 'pft.setup.draft';
const PROGRESS_CHARTS = 'pft.progress.charts';

/** The last Health Connect sync on this phone (#36). Device state, never plan data. */
export type HcSyncState = {
  at: string;
  ok: boolean;
  days: number;
  failed: string[];
  /** A sync has completed at least once: later syncs re-read 7 days instead of 30. */
  firstDone: boolean;
  /** The local day of the last sync in which every allowed type was read (#46): the next sync backfills from it. */
  lastFullSync?: string;
  /** Per type: read / couldn't read / not allowed, with counts and dates only (#44). Missing in older states. */
  types?: Record<string, HcTypeResult>;
};

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
  /** Null until the first sync has finished: the next sync then reads 30 days instead of 7. */
  async healthConnectSync(): Promise<HcSyncState | null> {
    try {
      const raw = await secrets.get(HC_SYNC);
      return raw ? (JSON.parse(raw) as HcSyncState) : null;
    } catch {
      return null;
    }
  },
  async setHealthConnectSync(s: HcSyncState): Promise<void> {
    await secrets.set(HC_SYNC, JSON.stringify(s));
  },
  /** First-run setup answers so far (#49), so setup resumes after a restart. Small: answers and step only. */
  async setupDraft(): Promise<string | null> {
    return secrets.get(SETUP_DRAFT).catch(() => null);
  },
  async setSetupDraft(json: string): Promise<void> {
    await secrets.set(SETUP_DRAFT, json);
  },
  /** Progress chart order and hidden charts (#52): a device choice, never plan data. */
  async progressCharts(): Promise<{ order?: string[]; hidden?: string[] } | null> {
    try {
      const raw = await secrets.get(PROGRESS_CHARTS);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async setProgressCharts(v: { order: string[]; hidden: string[] }): Promise<void> {
    await secrets.set(PROGRESS_CHARTS, JSON.stringify(v));
  },
  async clearSetupDraft(): Promise<void> {
    await secrets.remove(SETUP_DRAFT);
  },
};
