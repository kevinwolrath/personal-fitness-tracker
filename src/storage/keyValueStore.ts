import type { ImportSession, Observation } from '../observations/types';
import type {
  ActivityLog,
  ActivityLogRecord,
  CompletionEvent,
  ConfigChange,
  DaySnapshot,
  DayRecords,
  ExerciseLog,
  MuscleReport,
  QuickLogEntry,
  StoreSnapshot,
  StoredPlan,
  TrackingStore,
  MealCompletion,
} from './types';
import type { MealLog } from '../nutrition/contract';

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
  observations: Observation[];
  quickLogs: QuickLogEntry[];
  imports: ImportSession[];
  configChanges: ConfigChange[];
  completionEvents: CompletionEvent[];
  /** key: `${planId}|${date}` */
  daySnapshots: Record<string, DaySnapshot>;
  /** #56. Additive: documents written before it read as empty lists. */
  exerciseLogs: ExerciseLog[];
  muscleReports: MuscleReport[];
  /** #97. Additive: documents written before it read as an empty list. */
  mealLogs: MealLog[];
};

export const STORAGE_KEY = 'pft:tracking:v1';
const dayKey = (planId: string, date: string) => `${planId}|${date}`;
const splitKey = (k: string) => {
  const i = k.lastIndexOf('|');
  return { planId: k.slice(0, i), date: k.slice(i + 1) };
};
const empty = (): Doc => ({ version: 1, plan: null, activities: {}, overrides: {}, observations: [], quickLogs: [], imports: [], configChanges: [], completionEvents: [], daySnapshots: {}, exerciseLogs: [], muscleReports: [], mealLogs: [] });
const byKey = <T>(...keys: (keyof T)[]) => (a: T, b: T) => {
  for (const k of keys) {
    const c = String(a[k]).localeCompare(String(b[k]));
    if (c) return c;
  }
  return 0;
};
const upsertById = <T extends { id: string }>(list: T[], item: T) => {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
};

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
      return doc.version === 1 ? { ...empty(), ...doc } : empty();
    } catch {
      return empty();
    }
  }

  private update(fn: (doc: Doc) => void): void {
    const doc = this.read();
    fn(doc);
    this.kv.setItem(STORAGE_KEY, JSON.stringify(doc));
  }

  async getActivePlan(): Promise<StoredPlan | null> {
    const p = this.read().plan;
    return p && { ...p, origin: p.origin ?? 'seed' }; // documents written before #7 have no origin
  }

  async setActivePlan(plan: StoredPlan) {
    this.update((d) => {
      d.plan = plan;
    });
  }

  async getDay(planId: string, date: string): Promise<DayRecords> {
    const d = this.read();
    const k = dayKey(planId, date);
    return {
      activities: { ...(d.activities[k] ?? {}) },
      dayTypeOverride: d.overrides[k] ?? null,
      observations: d.observations.filter((o) => o.date === date).sort(byKey<Observation>('recordedAt', 'id')),
      quickLogs: d.quickLogs.filter((q) => q.planId === planId && q.date === date).sort(byKey<QuickLogEntry>('at')),
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

  async addObservations(observations: Observation[]) {
    this.update((d) => observations.forEach((o) => upsertById(d.observations, o)));
  }

  async removeObservation(id: string) {
    this.update((d) => {
      d.observations = d.observations.filter((o) => o.id !== id);
    });
  }

  async replaceIntegrationObservations(importId: string, dates: string[], metrics: string[], observations: Observation[]) {
    if (!dates.length || !metrics.length) return;
    const ds = new Set(dates);
    const ms = new Set(metrics);
    // One document write: atomic by construction.
    this.update((d) => {
      d.observations = d.observations.filter((o) => !(o.source.type === 'integration' && o.source.importId === importId && ds.has(o.date) && ms.has(o.metric)));
      observations.forEach((o) => upsertById(d.observations, o));
    });
  }

  async latestObservation(metric: string, onOrBefore: string) {
    const candidates = this.read().observations.filter((o) => o.metric === metric && o.kind === 'observed' && o.date <= onOrBefore);
    const imported = (o: Observation) => (o.source.type === 'integration' ? 1 : 0);
    candidates.sort(
      (a, b) => b.date.localeCompare(a.date) || imported(a) - imported(b) || b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id),
    );
    return candidates[0] ?? null;
  }

  async observationsFor(metrics: string[]) {
    const want = new Set(metrics);
    return this.read()
      .observations.filter((o) => want.has(o.metric) && o.kind === 'observed')
      .sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt) || a.id.localeCompare(b.id));
  }

  async planHistory(planId: string) {
    const d = this.read();
    const activityLogs: ActivityLogRecord[] = Object.entries(d.activities).flatMap(([k, day]) => {
      const key = splitKey(k);
      return key.planId === planId ? Object.values(day).map((log) => ({ ...log, ...key })) : [];
    });
    const dayOverrides = Object.entries(d.overrides)
      .map(([k, dayTypeId]) => ({ ...splitKey(k), dayTypeId }))
      .filter((o) => o.planId === planId);
    return { activityLogs: activityLogs.sort(byKey<ActivityLogRecord>('date', 'activityId')), dayOverrides: dayOverrides.sort(byKey('date')) };
  }

  async saveImport(session: ImportSession, observations: Observation[]) {
    // One document write: atomic by construction.
    this.update((d) => {
      upsertById(d.imports, session);
      observations.forEach((o) => upsertById(d.observations, o));
    });
  }

  async addQuickLog(entry: QuickLogEntry) {
    this.update((d) => upsertById(d.quickLogs, entry));
  }

  async removeQuickLog(id: string) {
    this.update((d) => {
      d.quickLogs = d.quickLogs.filter((q) => q.id !== id);
    });
  }

  async logCompletion(planId: string, date: string, activityId: string, log: ActivityLog | null, event: CompletionEvent, snapshot: DaySnapshot) {
    // One document write: atomic by construction.
    this.update((d) => {
      const k = dayKey(planId, date);
      const day = (d.activities[k] ??= {});
      if (log) day[activityId] = log;
      else delete day[activityId];
      if (!Object.keys(day).length) delete d.activities[k];
      upsertById(d.completionEvents, event);
      d.daySnapshots[k] = snapshot;
    });
  }

  async completionEvents(planId: string, date: string): Promise<CompletionEvent[]> {
    return this.read()
      .completionEvents.filter((e) => e.planId === planId && e.date === date)
      .sort(byKey<CompletionEvent>('at', 'id'));
  }

  async daySnapshot(planId: string, date: string): Promise<DaySnapshot | null> {
    return this.read().daySnapshots[dayKey(planId, date)] ?? null;
  }

  async applyConfigChange(plan: StoredPlan, change: ConfigChange) {
    // One document write: atomic by construction.
    this.update((d) => {
      d.plan = plan;
      upsertById(d.configChanges, change);
    });
  }

  async configHistory(): Promise<ConfigChange[]> {
    return [...this.read().configChanges].sort((a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.toRevision - a.toRevision);
  }

  async firstRecordDate(): Promise<string | null> {
    const d = this.read();
    const dates = [
      ...d.observations.map((o) => o.date),
      ...Object.keys(d.activities).map((k) => splitKey(k).date),
      ...Object.keys(d.overrides).map((k) => splitKey(k).date),
      ...d.quickLogs.map((q) => q.date),
      ...d.exerciseLogs.map((l) => l.date),
      ...d.mealLogs.map((m) => m.date),
    ];
    return dates.length ? dates.reduce((a, b) => (b < a ? b : a)) : null;
  }

  async exerciseLogs(range: { from?: string; to?: string } = {}): Promise<ExerciseLog[]> {
    return this.read()
      .exerciseLogs.filter((l) => (!range.from || l.date >= range.from) && (!range.to || l.date <= range.to))
      .sort(byKey<ExerciseLog>('at', 'id'));
  }

  async addExerciseLog(log: ExerciseLog) {
    this.update((d) => upsertById(d.exerciseLogs, log));
  }

  async removeExerciseLog(id: string) {
    this.update((d) => {
      d.exerciseLogs = d.exerciseLogs.filter((l) => l.id !== id);
    });
  }

  async mealLogs(range: { from?: string; to?: string } = {}): Promise<MealLog[]> {
    return this.read()
      .mealLogs.filter((m) => (!range.from || m.date >= range.from) && (!range.to || m.date <= range.to))
      .sort(byKey<MealLog>('date', 'at', 'id'));
  }

  private static applyCompletion(d: Doc, c: MealCompletion) {
    const k = dayKey(c.planId, c.date);
    const day = (d.activities[k] ??= {});
    if (c.log) day[c.activityId] = c.log;
    else delete day[c.activityId];
    if (!Object.keys(day).length) delete d.activities[k];
    upsertById(d.completionEvents, c.event);
    d.daySnapshots[k] = c.snapshot;
  }

  async saveMealLog(log: MealLog, completion?: MealCompletion | null) {
    // One document write: atomic by construction.
    this.update((d) => {
      upsertById(d.mealLogs, log);
      if (completion) KeyValueTrackingStore.applyCompletion(d, completion);
    });
  }

  async removeMealLog(id: string, completion?: MealCompletion | null) {
    this.update((d) => {
      d.mealLogs = d.mealLogs.filter((m) => m.id !== id);
      if (completion) KeyValueTrackingStore.applyCompletion(d, completion);
    });
  }

  async muscleReports(): Promise<MuscleReport[]> {
    return [...this.read().muscleReports].sort(byKey<MuscleReport>('at', 'id'));
  }

  async addMuscleReport(report: MuscleReport) {
    this.update((d) => upsertById(d.muscleReports, report));
  }

  async clearMuscleReport(id: string, at: string) {
    this.update((d) => {
      const r = d.muscleReports.find((x) => x.id === id);
      if (r) r.clearedAt = at;
    });
  }

  async snapshot(): Promise<StoreSnapshot> {
    const d = this.read();
    const activityLogs: ActivityLogRecord[] = Object.entries(d.activities).flatMap(([k, day]) => {
      const { planId, date } = splitKey(k);
      return Object.values(day).map((log) => ({ ...log, planId, date }));
    });
    return {
      plans: d.plan ? [d.plan] : [],
      activityLogs: activityLogs.sort(byKey<ActivityLogRecord>('date', 'planId', 'activityId')),
      dayOverrides: Object.entries(d.overrides)
        .map(([k, dayTypeId]) => ({ ...splitKey(k), dayTypeId }))
        .sort(byKey('date', 'planId')),
      observations: [...d.observations].sort(byKey<Observation>('date', 'recordedAt', 'id')),
      quickLogs: [...d.quickLogs].sort(byKey<QuickLogEntry>('at', 'id')),
      imports: [...d.imports].sort(byKey<ImportSession>('createdAt', 'id')),
      configChanges: [...d.configChanges].sort((a, b) => a.appliedAt.localeCompare(b.appliedAt) || a.toRevision - b.toRevision),
      completionEvents: [...d.completionEvents].sort(byKey<CompletionEvent>('date', 'at', 'id')),
      daySnapshots: Object.values(d.daySnapshots).sort(byKey<DaySnapshot>('date', 'planId')),
      exerciseLogs: [...d.exerciseLogs].sort(byKey<ExerciseLog>('at', 'id')),
      muscleReports: [...d.muscleReports].sort(byKey<MuscleReport>('at', 'id')),
      mealLogs: [...d.mealLogs].sort(byKey<MealLog>('date', 'at', 'id')),
    };
  }

  async restore(s: StoreSnapshot) {
    this.update((d) => {
      if (s.plans[0]) d.plan = s.plans[0];
      for (const { planId, date, ...log } of s.activityLogs) (d.activities[dayKey(planId, date)] ??= {})[log.activityId] = log;
      for (const o of s.dayOverrides) d.overrides[dayKey(o.planId, o.date)] = o.dayTypeId;
      s.imports.forEach((i) => upsertById(d.imports, i));
      s.observations.forEach((o) => upsertById(d.observations, o));
      s.quickLogs.forEach((q) => upsertById(d.quickLogs, q));
      (s.configChanges ?? []).forEach((c) => upsertById(d.configChanges, c));
      (s.completionEvents ?? []).forEach((e) => upsertById(d.completionEvents, e));
      for (const snap of s.daySnapshots ?? []) d.daySnapshots[dayKey(snap.planId, snap.date)] = snap;
      (s.exerciseLogs ?? []).forEach((l) => upsertById(d.exerciseLogs, l));
      (s.muscleReports ?? []).forEach((r) => upsertById(d.muscleReports, r));
      (s.mealLogs ?? []).forEach((m) => upsertById(d.mealLogs, m));
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
