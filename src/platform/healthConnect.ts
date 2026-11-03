import { Linking, Platform } from 'react-native';
import { hcRecordType, hcTypes, type HcDayTotal, type HcRead, type HcSession, type HcType, type HcWeight } from '../observations/healthConnect';
import { addDays, type LocalDate } from '../plan/dates';

/**
 * Android Health Connect adapter (#36, contract 12). READ ONLY: this file never calls an insert, update or delete
 * API, and the app's manifest declares only the five READ_* permissions. The meaning of the data lives in
 * src/observations/healthConnect.ts; this file only talks to the platform. See healthConnect.web.ts for the web
 * test surface's stand-in.
 */
export type HcAvailability = 'available' | 'not_installed' | 'update_required' | 'unsupported';

type Lib = typeof import('react-native-health-connect');
let lib: Lib | null = null;
let initialized: Promise<boolean> | null = null;

/** Loaded lazily, on Android only: the native module throws at import time where it doesn't exist. */
function load(): Lib | null {
  if (Platform.OS !== 'android') return null;
  try {
    lib ??= require('react-native-health-connect') as Lib;
    return lib;
  } catch {
    return null;
  }
}

async function ready(): Promise<Lib> {
  const hc = load();
  if (!hc) throw new Error('Health Connect is not available on this device');
  initialized ??= hc.initialize().catch((e) => {
    initialized = null;
    throw e;
  });
  if (!(await initialized)) throw new Error('Health Connect could not start');
  return hc;
}

const permissions = () => hcTypes.map((t) => ({ accessType: 'read' as const, recordType: hcRecordType[t] }));
const typeOf = (recordType: string): HcType | undefined => hcTypes.find((t) => hcRecordType[t] === recordType);
const grantedTypes = (granted: { accessType: string; recordType: string }[]): HcType[] =>
  hcTypes.filter((t) => granted.some((p) => p.accessType === 'read' && typeOf(p.recordType) === t));

/** Local midnight of a date, as an instant. */
const startOf = (d: LocalDate) => new Date(`${d}T00:00:00`).toISOString();

async function readAll<T>(hc: Lib, recordType: string, startTime: string, endTime: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const page: { records: unknown[]; pageToken?: string } = await hc.readRecords(recordType as never, {
      timeRangeFilter: { operator: 'between', startTime, endTime },
      pageSize: 1000,
      pageToken,
    });
    out.push(...(page.records as T[]));
    pageToken = page.pageToken || undefined;
  } while (pageToken);
  return out;
}

type Meta = { metadata?: { id?: string; dataOrigin?: string } };

export const healthConnect = {
  /** Whether this surface talks to a real Health Connect. */
  real: true,

  async availability(): Promise<HcAvailability> {
    const hc = load();
    if (!hc) return 'unsupported';
    try {
      const status = await hc.getSdkStatus();
      if (status === hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
      if (status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update_required';
      return 'not_installed';
    } catch {
      return 'unsupported';
    }
  },

  /** The data types the user has allowed (read access only). */
  async granted(): Promise<HcType[]> {
    const hc = await ready();
    return grantedTypes(await hc.getGrantedPermissions());
  },

  /** Ask for read access to the five types (an explicit user action: the only place we ask). */
  async request(): Promise<HcType[]> {
    const hc = await ready();
    return grantedTypes(await hc.requestPermission(permissions()));
  },

  /**
   * Read the allowed types for these local days. A type that fails is reported in `failed` and left out of
   * `read`, so the others still sync and its stored values stay as they were.
   */
  async read(types: HcType[], dates: LocalDate[]): Promise<{ read: HcRead; failed: HcType[] }> {
    const hc = await ready();
    const read: HcRead = {};
    const failed: HcType[] = [];
    const from = startOf(dates[0]);
    const to = startOf(addDays(dates[dates.length - 1], 1));
    const dayTotal = async (recordType: 'Steps' | 'ActiveCaloriesBurned'): Promise<HcDayTotal[]> =>
      Promise.all(
        dates.map(async (date) => {
          const r: any = await hc.aggregateRecord({
            recordType,
            timeRangeFilter: { operator: 'between', startTime: startOf(date), endTime: startOf(addDays(date, 1)) },
          } as never);
          const value = recordType === 'Steps' ? (r.COUNT_TOTAL ?? 0) : (r.ACTIVE_CALORIES_TOTAL?.inKilocalories ?? 0);
          return { date, value, origins: r.dataOrigins ?? [] };
        }),
      );
    const tasks: Record<HcType, () => Promise<void>> = {
      steps: async () => {
        read.steps = await dayTotal('Steps');
      },
      active_energy: async () => {
        read.activeKcal = await dayTotal('ActiveCaloriesBurned');
      },
      exercise: async () => {
        const rs = await readAll<Meta & { startTime: string; endTime: string; exerciseType?: number; title?: string }>(hc, 'ExerciseSession', from, to);
        read.exercise = rs.map(
          (r): HcSession => ({ id: r.metadata?.id ?? `${r.startTime}|${r.metadata?.dataOrigin}`, start: r.startTime, end: r.endTime, origin: r.metadata?.dataOrigin ?? '', exerciseType: r.exerciseType, title: r.title }),
        );
      },
      weight: async () => {
        const rs = await readAll<Meta & { time: string; weight: { inKilograms: number } }>(hc, 'Weight', from, to);
        read.weight = rs.map((r): HcWeight => ({ id: r.metadata?.id ?? r.time, time: r.time, kg: r.weight.inKilograms, origin: r.metadata?.dataOrigin ?? '' }));
      },
      sleep: async () => {
        // A night that ends on the first day started the evening before: read from noon the day before.
        const sleepFrom = new Date(`${addDays(dates[0], -1)}T12:00:00`).toISOString();
        const rs = await readAll<Meta & { startTime: string; endTime: string; stages?: { startTime: string; endTime: string; stage: number }[] }>(hc, 'SleepSession', sleepFrom, to);
        read.sleep = rs.map(
          (r): HcSession => ({
            id: r.metadata?.id ?? r.startTime,
            start: r.startTime,
            end: r.endTime,
            origin: r.metadata?.dataOrigin ?? '',
            stages: r.stages?.map((s) => ({ start: s.startTime, end: s.endTime, stage: s.stage })),
          }),
        );
      },
    };
    await Promise.all(
      types.map((t) =>
        tasks[t]().catch(() => {
          failed.push(t);
        }),
      ),
    );
    for (const t of failed) {
      if (t === 'steps') delete read.steps;
      if (t === 'active_energy') delete read.activeKcal;
      if (t === 'exercise') delete read.exercise;
      if (t === 'weight') delete read.weight;
      if (t === 'sleep') delete read.sleep;
    }
    return { read, failed };
  },

  /** Health Connect's own screen for this app's permissions and data (where access is changed or revoked). */
  openSettings(): void {
    try {
      load()?.openHealthConnectSettings();
    } catch {
      // nothing to open
    }
  },

  /** Play Store page to install or update Health Connect (Android 13 and older ship it as an app). */
  openInstall(): void {
    Linking.openURL('market://details?id=com.google.android.apps.healthdata').catch(() =>
      Linking.openURL('https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata'),
    );
  },
};
