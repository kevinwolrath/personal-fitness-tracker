import type { LocalDate } from '../plan/dates';

/** The verbatim plan package plus import metadata (contract 04 `plan`). */
export type StoredPlan = {
  planId: string;
  revision: number;
  formatVersion: number;
  json: string;
  importedAt: string;
};

export type ActivityStatus = 'pending' | 'done' | 'skipped';

export type ActivityLog = {
  activityId: string;
  status: ActivityStatus;
  /** Units completed for `count` tracking; 0 for `check`. */
  count: number;
  labelSnapshot: string;
  updatedAt: string;
};

export type MeasurementEntry = {
  id: string;
  planId: string;
  measurementId: string;
  date: LocalDate;
  value: number;
  recordedAt: string;
};

export type QuickLogEntry = {
  id: string;
  planId: string;
  quickLogId: string;
  date: LocalDate;
  at: string;
};

export type DayRecords = {
  activities: Record<string, ActivityLog>;
  dayTypeOverride: string | null;
  measurements: MeasurementEntry[];
  quickLogs: QuickLogEntry[];
};

/**
 * The only way screens touch persisted data (contract 04).
 * Implementations: SQLite on native, key-value (localStorage) on web.
 * Both must pass the shared suite in src/storage/__tests__/store.contract.ts.
 */
export interface TrackingStore {
  getActivePlan(): Promise<StoredPlan | null>;
  setActivePlan(plan: StoredPlan): Promise<void>;

  getDay(planId: string, date: LocalDate): Promise<DayRecords>;
  /** Upsert, or delete when `log` is null (undo back to "not done"). */
  setActivity(planId: string, date: LocalDate, activityId: string, log: ActivityLog | null): Promise<void>;
  setDayOverride(planId: string, date: LocalDate, dayTypeId: string | null): Promise<void>;

  addMeasurement(entry: MeasurementEntry): Promise<void>;
  removeMeasurement(id: string): Promise<void>;
  /** Latest entry on or before `date` (latest date, then latest recordedAt). */
  latestMeasurement(planId: string, measurementId: string, onOrBefore: LocalDate): Promise<MeasurementEntry | null>;

  addQuickLog(entry: QuickLogEntry): Promise<void>;
  removeQuickLog(id: string): Promise<void>;
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
