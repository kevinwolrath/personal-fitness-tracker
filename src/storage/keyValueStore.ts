import type {
  ActivityLog,
  DayRecords,
  MeasurementEntry,
  QuickLogEntry,
  StoredPlan,
  TrackingStore,
} from './types';

/** Minimal synchronous key-value backend: `window.localStorage` on web, a Map in tests. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

type Doc = {
  version: 1;
  plan: StoredPlan | null;
  /** key: `${planId}|${date}` */
  activities: Record<string, Record<string, ActivityLog>>;
  overrides: Record<string, string>;
  measurements: MeasurementEntry[];
  quickLogs: QuickLogEntry[];
};

export const STORAGE_KEY = 'pft:tracking:v1';
const dayKey = (planId: string, date: string) => `${planId}|${date}`;
const empty = (): Doc => ({ version: 1, plan: null, activities: {}, overrides: {}, measurements: [], quickLogs: [] });

/**
 * Web implementation of TrackingStore (contract 04): one JSON document in key-value storage.
 * Data volume is tiny (a few rows per day), so whole-document rewrites are fine.
 */
export class KeyValueTrackingStore implements TrackingStore {
  constructor(private kv: KeyValue) {}

  private read(): Doc {
    const raw = this.kv.getItem(STORAGE_KEY);
    if (!raw) return empty();
    try {
      const doc = JSON.parse(raw) as Doc;
      return doc.version === 1 ? doc : empty();
    } catch {
      return empty();
    }
  }

  private update(fn: (doc: Doc) => void): void {
    const doc = this.read();
    fn(doc);
    this.kv.setItem(STORAGE_KEY, JSON.stringify(doc));
  }

  async getActivePlan() {
    return this.read().plan;
  }

  async setActivePlan(plan: StoredPlan) {
    this.update((d) => {
      d.plan = plan;
    });
  }

  async getDay(planId: string, date: string): Promise<DayRecords> {
    const d = this.read();
    const k = dayKey(planId, date);
    const byTime = <T>(key: keyof T) => (a: T, b: T) => String(a[key]).localeCompare(String(b[key]));
    return {
      activities: { ...(d.activities[k] ?? {}) },
      dayTypeOverride: d.overrides[k] ?? null,
      measurements: d.measurements.filter((m) => m.planId === planId && m.date === date).sort(byTime<MeasurementEntry>('recordedAt')),
      quickLogs: d.quickLogs.filter((q) => q.planId === planId && q.date === date).sort(byTime<QuickLogEntry>('at')),
    };
  }

  async setActivity(planId: string, date: string, activityId: string, log: ActivityLog | null) {
    this.update((d) => {
      const k = dayKey(planId, date);
      const day = (d.activities[k] ??= {});
      if (log) day[activityId] = log;
      else delete day[activityId];
      if (!Object.keys(day).length) delete d.activities[k];
    });
  }

  async setDayOverride(planId: string, date: string, dayTypeId: string | null) {
    this.update((d) => {
      const k = dayKey(planId, date);
      if (dayTypeId === null) delete d.overrides[k];
      else d.overrides[k] = dayTypeId;
    });
  }

  async addMeasurement(entry: MeasurementEntry) {
    this.update((d) => {
      d.measurements.push(entry);
    });
  }

  async removeMeasurement(id: string) {
    this.update((d) => {
      d.measurements = d.measurements.filter((m) => m.id !== id);
    });
  }

  async latestMeasurement(planId: string, measurementId: string, onOrBefore: string) {
    const candidates = this.read().measurements.filter(
      (m) => m.planId === planId && m.measurementId === measurementId && m.date <= onOrBefore,
    );
    candidates.sort((a, b) => b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt));
    return candidates[0] ?? null;
  }

  async addQuickLog(entry: QuickLogEntry) {
    this.update((d) => {
      d.quickLogs.push(entry);
    });
  }

  async removeQuickLog(id: string) {
    this.update((d) => {
      d.quickLogs = d.quickLogs.filter((q) => q.id !== id);
    });
  }
}

export class MemoryKeyValue implements KeyValue {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}
