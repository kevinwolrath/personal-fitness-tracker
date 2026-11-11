import { isEnergyDisplay, type EnergyDisplay } from '../energy';
import { hcTypes, type HcType, type HcTypeResult } from '../observations/healthConnect';
import { secrets } from './secrets';

/**
 * Device/app preferences: choices about this phone, never plan data (a plan change or Configure with AI can't
 * touch them). Stored with the same device storage as secrets (keystore natively, localStorage on web).
 */
const REMINDERS = 'pft.reminders.enabled';
const ENERGY = 'pft.display.energy';
const HC_SYNC = 'pft.healthConnect.sync';
const HC_WANTED = 'pft.healthConnect.wanted';
const SETUP_DRAFT = 'pft.setup.draft';
const PROGRESS_CHARTS = 'pft.progress.charts';
const TREND_ALERTS = 'pft.trend.alerts';
const TREND_STATE = 'pft.trend.state';

/** The last weight-trend alert on this phone and the last one seen on Progress (#57). */
export type TrendAlertState = { lastKey: string | null; lastAt: string | null; seenKey: string | null };

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
  /** Per type, the app it last came from, kept across syncs (#116): names the app to fix when it stops arriving. */
  lastApps?: Partial<Record<HcType, string>>;
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
  /** The Health Connect types the user ticked (#116). Null until they choose (or connect). */
  async healthConnectWanted(): Promise<HcType[] | null> {
    try {
      const raw = await secrets.get(HC_WANTED);
      const v: unknown = raw ? JSON.parse(raw) : null;
      return Array.isArray(v) ? hcTypes.filter((t) => v.includes(t)) : null;
    } catch {
      return null;
    }
  },
  async setHealthConnectWanted(types: HcType[]): Promise<void> {
    await secrets.set(HC_WANTED, JSON.stringify(types));
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
  /** Weight-trend alerts (#57): on unless turned off in Settings. */
  async trendAlerts(): Promise<boolean> {
    return (await secrets.get(TREND_ALERTS).catch(() => null)) !== 'false';
  },
  async setTrendAlerts(on: boolean): Promise<void> {
    await secrets.set(TREND_ALERTS, on ? 'true' : 'false');
  },
  async trendAlertState(): Promise<TrendAlertState> {
    try {
      const raw = await secrets.get(TREND_STATE);
      return { lastKey: null, lastAt: null, seenKey: null, ...(raw ? JSON.parse(raw) : {}) };
    } catch {
      return { lastKey: null, lastAt: null, seenKey: null };
    }
  },
  async setTrendAlertState(s: TrendAlertState): Promise<void> {
    await secrets.set(TREND_STATE, JSON.stringify(s));
  },
  async clearSetupDraft(): Promise<void> {
    await secrets.remove(SETUP_DRAFT);
  },
};

/**
 * What a full backup (#128) carries from device storage, by key. Every key the app writes must be listed in exactly
 * one of these (a test scans the source for `pft.` keys), so a new key can't be silently left out of backups.
 * - included: user choices and app-owned state, restored as they were;
 * - excluded: secrets and device-specific state, which must be set up again on the new phone.
 */
export const BACKUP_PREFERENCE_KEYS = {
  included: [
    'pft.display.theme',
    ENERGY,
    'pft.gamification.v1',
    PROGRESS_CHARTS,
    TREND_ALERTS,
    TREND_STATE,
    REMINDERS,
    HC_WANTED,
    'pft.healthSync.url',
  ],
  excluded: {
    'pft.anthropic.apiKey': 'API key: a secret, never written to a backup. Enter it again after restoring.',
    [HC_SYNC]: 'Health Connect sync state belongs to this phone; the next sync re-reads recent days without duplicating them.',
    [SETUP_DRAFT]: 'An unfinished setup on this phone, not saved data.',
    'pft.healthSync.credential': 'Health data sync key: a secret, never written to a backup. The data ID travels with the backup; link again on the new phone.',
    'pft.healthSync.pending': 'An unfinished health data link on this phone (a secret).',
    'pft.healthSync.status': 'The last health data sync on this phone.',
    'pft.healthSync.enrollmentKey': 'Legacy (#136 first version): a typed enrollment key. Deleted when Health data sync opens; keys now come from the build.',
  } as Record<string, string>,
} as const;
