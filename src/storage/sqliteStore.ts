import type { ImportSession, Observation } from '../observations/types';
import type {
  ActivityLog,
  ActivityLogRecord,
  DayOverrideRecord,
  CompletionEvent,
  ConfigChange,
  DayRecords,
  DaySnapshot,
  QuickLogEntry,
  StoreSnapshot,
  StoredPlan,
  TrackingStore,
} from './types';

type Param = string | number | null;

/** The subset of expo-sqlite's SQLiteDatabase we use, so tests can supply node:sqlite. */
export interface SqlDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: Param[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: Param[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: Param[]): Promise<T | null>;
}

/** Numbered, forward-only migrations; index + 1 = PRAGMA user_version after it runs. */
const migrations = [
  `CREATE TABLE plan (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     plan_id TEXT NOT NULL, revision INTEGER NOT NULL, format_version INTEGER NOT NULL,
     json TEXT NOT NULL, imported_at TEXT NOT NULL);
   CREATE TABLE activity_log (
     plan_id TEXT NOT NULL, date TEXT NOT NULL, activity_id TEXT NOT NULL,
     status TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
     label_snapshot TEXT NOT NULL, updated_at TEXT NOT NULL,
     PRIMARY KEY (plan_id, date, activity_id));
   CREATE TABLE observation (
     id TEXT PRIMARY KEY, date TEXT NOT NULL, metric TEXT NOT NULL,
     value REAL NOT NULL, unit TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('observed', 'inferred')),
     label TEXT, note TEXT,
     source_type TEXT NOT NULL, source_app TEXT, captured_at TEXT, confidence REAL,
     import_id TEXT, asset_id TEXT, evidence TEXT, edited INTEGER NOT NULL DEFAULT 0,
     recorded_at TEXT NOT NULL);
   CREATE INDEX observation_metric_date ON observation (metric, date);
   CREATE INDEX observation_date ON observation (date);
   CREATE TABLE import_session (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, extractor TEXT NOT NULL, assets_json TEXT NOT NULL);
   CREATE TABLE quick_log (
     id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, quick_log_id TEXT NOT NULL,
     date TEXT NOT NULL, at TEXT NOT NULL);
   CREATE INDEX quick_log_day ON quick_log (plan_id, date);
   CREATE TABLE day_override (
     plan_id TEXT NOT NULL, date TEXT NOT NULL, day_type_id TEXT NOT NULL,
     PRIMARY KEY (plan_id, date));`,
  // 2 (#7): plan origin + configuration change history. Additive only.
  `ALTER TABLE plan ADD COLUMN origin TEXT NOT NULL DEFAULT 'seed';
   CREATE TABLE config_change (
     id TEXT PRIMARY KEY, applied_at TEXT NOT NULL, sections TEXT NOT NULL, payload TEXT NOT NULL,
     from_revision INTEGER NOT NULL, to_revision INTEGER NOT NULL, previous_plan_json TEXT NOT NULL);`,
  // 3 (#10): completion variant/requirement, append-only completion events, prescription snapshots. Additive only.
  `ALTER TABLE activity_log ADD COLUMN variant TEXT;
   ALTER TABLE activity_log ADD COLUMN requirement_id TEXT;
   CREATE TABLE completion_event (
     id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, date TEXT NOT NULL, activity_id TEXT NOT NULL, requirement_id TEXT,
     action TEXT NOT NULL, count INTEGER NOT NULL, variant TEXT, label TEXT NOT NULL, purpose TEXT, at TEXT NOT NULL);
   CREATE INDEX completion_event_day ON completion_event (plan_id, date, at);
   CREATE TABLE day_snapshot (
     plan_id TEXT NOT NULL, date TEXT NOT NULL, plan_revision INTEGER NOT NULL, prescribed TEXT NOT NULL,
     updated_at TEXT NOT NULL, PRIMARY KEY (plan_id, date));`,
  // 4 (#28): exercise-level ticks within a session, as a JSON array of exercise keys. Additive only.
  `ALTER TABLE activity_log ADD COLUMN exercises_done TEXT;`,
];

export async function migrate(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < migrations.length; v++) {
    await db.execAsync(`BEGIN; ${migrations[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
  }
}

type ObservationRow = {
  id: string;
  date: string;
  metric: string;
  value: number;
  unit: string;
  kind: Observation['kind'];
  label: string | null;
  note: string | null;
  source_type: Observation['source']['type'];
  source_app: string | null;
  captured_at: string | null;
  confidence: number | null;
  import_id: string | null;
  asset_id: string | null;
  evidence: string | null;
  edited: number;
  recorded_at: string;
};

const toObservation = (r: ObservationRow): Observation => ({
  id: r.id,
  date: r.date,
  metric: r.metric,
  value: r.value,
  unit: r.unit,
  kind: r.kind,
  label: r.label,
  note: r.note,
  source: {
    type: r.source_type,
    app: r.source_app,
    capturedAt: r.captured_at,
    confidence: r.confidence,
    importId: r.import_id,
    assetId: r.asset_id,
    evidence: r.evidence,
    edited: r.edited === 1,
  },
  recordedAt: r.recorded_at,
});

type ActivityRow = {
  plan_id: string; date: string; activity_id: string; status: ActivityLog['status']; count: number; label_snapshot: string; updated_at: string;
  variant: ActivityLog['variant'] | null; requirement_id: string | null; exercises_done?: string | null;
};
const toActivity = (a: ActivityRow): ActivityLogRecord => ({
  planId: a.plan_id,
  date: a.date,
  activityId: a.activity_id,
  status: a.status,
  count: a.count,
  labelSnapshot: a.label_snapshot,
  updatedAt: a.updated_at,
  ...(a.variant ? { variant: a.variant } : {}),
  ...(a.requirement_id ? { requirementId: a.requirement_id } : {}),
  ...(a.exercises_done ? { exercisesDone: JSON.parse(a.exercises_done) as string[] } : {}),
});
type EventRow = {
  id: string; plan_id: string; date: string; activity_id: string; requirement_id: string | null; action: CompletionEvent['action'];
  count: number; variant: CompletionEvent['variant']; label: string; purpose: string | null; at: string;
};
const toEvent = (e: EventRow): CompletionEvent => ({
  id: e.id, planId: e.plan_id, date: e.date, activityId: e.activity_id, requirementId: e.requirement_id, action: e.action,
  count: e.count, variant: e.variant, label: e.label, purpose: e.purpose, at: e.at,
});
type SnapshotRow = { plan_id: string; date: string; plan_revision: number; prescribed: string; updated_at: string };
const toSnapshotRecord = (r: SnapshotRow): DaySnapshot => ({
  planId: r.plan_id, date: r.date, planRevision: r.plan_revision, prescribed: JSON.parse(r.prescribed), updatedAt: r.updated_at,
});

type QuickLogRow = { id: string; plan_id: string; quick_log_id: string; date: string; at: string };
const toQuickLog = (q: QuickLogRow): QuickLogEntry => ({ id: q.id, planId: q.plan_id, quickLogId: q.quick_log_id, date: q.date, at: q.at });

export class SqliteTrackingStore implements TrackingStore {
  private constructor(private db: SqlDatabase) {}

  static async open(db: SqlDatabase): Promise<SqliteTrackingStore> {
    await migrate(db);
    return new SqliteTrackingStore(db);
  }

  private async transaction(fn: () => Promise<void>): Promise<void> {
    await this.db.execAsync('BEGIN');
    try {
      await fn();
      await this.db.execAsync('COMMIT');
    } catch (e) {
      await this.db.execAsync('ROLLBACK');
      throw e;
    }
  }

  async getActivePlan(): Promise<StoredPlan | null> {
    const r = await this.db.getFirstAsync<{ plan_id: string; revision: number; format_version: number; json: string; imported_at: string; origin: StoredPlan['origin'] }>(
      'SELECT plan_id, revision, format_version, json, imported_at, origin FROM plan WHERE id = 1',
      [],
    );
    return r && { planId: r.plan_id, revision: r.revision, formatVersion: r.format_version, json: r.json, importedAt: r.imported_at, origin: r.origin ?? 'seed' };
  }

  async setActivePlan(p: StoredPlan): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plan (id, plan_id, revision, format_version, json, imported_at, origin) VALUES (1, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET plan_id = excluded.plan_id, revision = excluded.revision,
         format_version = excluded.format_version, json = excluded.json, imported_at = excluded.imported_at,
         origin = excluded.origin`,
      [p.planId, p.revision, p.formatVersion, p.json, p.importedAt, p.origin ?? 'seed'],
    );
  }

  async getDay(planId: string, date: string): Promise<DayRecords> {
    const [acts, override, obs, qs] = await Promise.all([
      this.db.getAllAsync<ActivityRow>('SELECT * FROM activity_log WHERE plan_id = ? AND date = ?', [planId, date]),
      this.db.getFirstAsync<{ day_type_id: string }>('SELECT day_type_id FROM day_override WHERE plan_id = ? AND date = ?', [planId, date]),
      this.db.getAllAsync<ObservationRow>('SELECT * FROM observation WHERE date = ? ORDER BY recorded_at, id', [date]),
      this.db.getAllAsync<QuickLogRow>('SELECT * FROM quick_log WHERE plan_id = ? AND date = ? ORDER BY at', [planId, date]),
    ]);
    return {
      activities: Object.fromEntries(
        acts.map((a) => {
          const { planId: _p, date: _d, ...log } = toActivity(a);
          return [a.activity_id, log];
        }),
      ),
      dayTypeOverride: override?.day_type_id ?? null,
      observations: obs.map(toObservation),
      quickLogs: qs.map(toQuickLog),
    };
  }

  async setActivity(planId: string, date: string, activityId: string, log: ActivityLog | null): Promise<void> {
    if (!log) {
      await this.db.runAsync('DELETE FROM activity_log WHERE plan_id = ? AND date = ? AND activity_id = ?', [planId, date, activityId]);
      return;
    }
    await this.upsertActivity({ ...log, planId, date, activityId });
  }

  private async upsertActivity(a: ActivityLogRecord): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO activity_log (plan_id, date, activity_id, status, count, label_snapshot, updated_at, variant, requirement_id, exercises_done)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plan_id, date, activity_id) DO UPDATE SET status = excluded.status, count = excluded.count,
         label_snapshot = excluded.label_snapshot, updated_at = excluded.updated_at,
         variant = excluded.variant, requirement_id = excluded.requirement_id, exercises_done = excluded.exercises_done`,
      [a.planId, a.date, a.activityId, a.status, a.count, a.labelSnapshot, a.updatedAt, a.variant ?? null, a.requirementId ?? null,
       a.exercisesDone ? JSON.stringify(a.exercisesDone) : null],
    );
  }

  async setDayOverride(planId: string, date: string, dayTypeId: string | null): Promise<void> {
    if (dayTypeId === null) {
      await this.db.runAsync('DELETE FROM day_override WHERE plan_id = ? AND date = ?', [planId, date]);
      return;
    }
    await this.db.runAsync(
      `INSERT INTO day_override (plan_id, date, day_type_id) VALUES (?, ?, ?)
       ON CONFLICT(plan_id, date) DO UPDATE SET day_type_id = excluded.day_type_id`,
      [planId, date, dayTypeId],
    );
  }

  private async upsertObservation(o: Observation): Promise<void> {
    const s = o.source;
    await this.db.runAsync(
      `INSERT OR REPLACE INTO observation
         (id, date, metric, value, unit, kind, label, note, source_type, source_app, captured_at, confidence,
          import_id, asset_id, evidence, edited, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [o.id, o.date, o.metric, o.value, o.unit, o.kind, o.label, o.note, s.type, s.app, s.capturedAt, s.confidence,
        s.importId, s.assetId, s.evidence, s.edited ? 1 : 0, o.recordedAt],
    );
  }

  async addObservations(observations: Observation[]): Promise<void> {
    await this.transaction(async () => {
      for (const o of observations) await this.upsertObservation(o);
    });
  }

  async removeObservation(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM observation WHERE id = ?', [id]);
  }

  async replaceIntegrationObservations(importId: string, dates: string[], metrics: string[], observations: Observation[]): Promise<void> {
    if (!dates.length || !metrics.length) return;
    const marks = (n: number) => Array(n).fill('?').join(', ');
    await this.transaction(async () => {
      await this.db.runAsync(
        `DELETE FROM observation WHERE source_type = 'integration' AND import_id = ? AND date IN (${marks(dates.length)}) AND metric IN (${marks(metrics.length)})`,
        [importId, ...dates, ...metrics],
      );
      for (const o of observations) await this.upsertObservation(o);
    });
  }

  async latestObservation(metric: string, onOrBefore: string): Promise<Observation | null> {
    const r = await this.db.getFirstAsync<ObservationRow>(
      `SELECT * FROM observation WHERE metric = ? AND kind = 'observed' AND date <= ?
       ORDER BY date DESC, (source_type = 'integration') ASC, recorded_at DESC, id DESC LIMIT 1`,
      [metric, onOrBefore],
    );
    return r ? toObservation(r) : null;
  }

  private async upsertImport(session: ImportSession): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO import_session (id, created_at, extractor, assets_json) VALUES (?, ?, ?, ?)',
      [session.id, session.createdAt, session.extractor, JSON.stringify(session.assets)],
    );
  }

  async saveImport(session: ImportSession, observations: Observation[]): Promise<void> {
    await this.transaction(async () => {
      await this.upsertImport(session);
      for (const o of observations) await this.upsertObservation(o);
    });
  }

  async addQuickLog(q: QuickLogEntry): Promise<void> {
    await this.db.runAsync('INSERT OR REPLACE INTO quick_log (id, plan_id, quick_log_id, date, at) VALUES (?, ?, ?, ?, ?)', [
      q.id,
      q.planId,
      q.quickLogId,
      q.date,
      q.at,
    ]);
  }

  async removeQuickLog(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM quick_log WHERE id = ?', [id]);
  }

  private async insertConfigChange(c: ConfigChange): Promise<void> {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO config_change (id, applied_at, sections, payload, from_revision, to_revision, previous_plan_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.appliedAt, JSON.stringify(c.sections), JSON.stringify(c.payload), c.fromRevision, c.toRevision, c.previousPlanJson],
    );
  }

  private async insertEvent(e: CompletionEvent): Promise<void> {
    await this.db.runAsync(
      `INSERT OR REPLACE INTO completion_event (id, plan_id, date, activity_id, requirement_id, action, count, variant, label, purpose, at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e.id, e.planId, e.date, e.activityId, e.requirementId, e.action, e.count, e.variant, e.label, e.purpose, e.at],
    );
  }

  private async upsertDaySnapshot(s: DaySnapshot): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO day_snapshot (plan_id, date, plan_revision, prescribed, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(plan_id, date) DO UPDATE SET plan_revision = excluded.plan_revision, prescribed = excluded.prescribed,
         updated_at = excluded.updated_at`,
      [s.planId, s.date, s.planRevision, JSON.stringify(s.prescribed), s.updatedAt],
    );
  }

  async logCompletion(planId: string, date: string, activityId: string, log: ActivityLog | null, event: CompletionEvent, snapshot: DaySnapshot): Promise<void> {
    await this.transaction(async () => {
      if (log) await this.upsertActivity({ ...log, planId, date, activityId });
      else await this.db.runAsync('DELETE FROM activity_log WHERE plan_id = ? AND date = ? AND activity_id = ?', [planId, date, activityId]);
      await this.insertEvent(event);
      await this.upsertDaySnapshot(snapshot);
    });
  }

  async completionEvents(planId: string, date: string): Promise<CompletionEvent[]> {
    return (await this.db.getAllAsync<EventRow>('SELECT * FROM completion_event WHERE plan_id = ? AND date = ? ORDER BY at, id', [planId, date])).map(toEvent);
  }

  async daySnapshot(planId: string, date: string): Promise<DaySnapshot | null> {
    const r = await this.db.getFirstAsync<SnapshotRow>('SELECT * FROM day_snapshot WHERE plan_id = ? AND date = ?', [planId, date]);
    return r ? toSnapshotRecord(r) : null;
  }

  async applyConfigChange(plan: StoredPlan, change: ConfigChange): Promise<void> {
    await this.transaction(async () => {
      await this.setActivePlan(plan);
      await this.insertConfigChange(change);
    });
  }

  async configHistory(): Promise<ConfigChange[]> {
    const rows = await this.db.getAllAsync<{ id: string; applied_at: string; sections: string; payload: string; from_revision: number; to_revision: number; previous_plan_json: string }>(
      'SELECT * FROM config_change ORDER BY applied_at DESC, to_revision DESC',
      [],
    );
    return rows.map((r) => ({
      id: r.id,
      appliedAt: r.applied_at,
      sections: JSON.parse(r.sections),
      payload: JSON.parse(r.payload),
      fromRevision: r.from_revision,
      toRevision: r.to_revision,
      previousPlanJson: r.previous_plan_json,
    }));
  }

  async firstRecordDate(): Promise<string | null> {
    const r = await this.db.getFirstAsync<{ first: string | null }>(
      `SELECT MIN(d) AS first FROM (
         SELECT MIN(date) AS d FROM observation UNION ALL SELECT MIN(date) FROM activity_log
         UNION ALL SELECT MIN(date) FROM day_override UNION ALL SELECT MIN(date) FROM quick_log)`,
      [],
    );
    return r?.first ?? null;
  }

  async snapshot(): Promise<StoreSnapshot> {
    const [plan, acts, overrides, obs, qs, imports] = await Promise.all([
      this.getActivePlan(),
      this.db.getAllAsync<ActivityRow>('SELECT * FROM activity_log ORDER BY date, plan_id, activity_id', []),
      this.db.getAllAsync<{ plan_id: string; date: string; day_type_id: string }>('SELECT * FROM day_override ORDER BY date, plan_id', []),
      this.db.getAllAsync<ObservationRow>('SELECT * FROM observation ORDER BY date, recorded_at, id', []),
      this.db.getAllAsync<QuickLogRow>('SELECT * FROM quick_log ORDER BY at, id', []),
      this.db.getAllAsync<{ id: string; created_at: string; extractor: string; assets_json: string }>(
        'SELECT * FROM import_session ORDER BY created_at, id',
        [],
      ),
    ]);
    const configChanges = (await this.configHistory()).reverse();
    const [events, snapshots] = await Promise.all([
      this.db.getAllAsync<EventRow>('SELECT * FROM completion_event ORDER BY date, at, id', []),
      this.db.getAllAsync<SnapshotRow>('SELECT * FROM day_snapshot ORDER BY date, plan_id', []),
    ]);
    return {
      configChanges,
      completionEvents: events.map(toEvent),
      daySnapshots: snapshots.map(toSnapshotRecord),
      plans: plan ? [plan] : [],
      activityLogs: acts.map(toActivity),
      dayOverrides: overrides.map((o): DayOverrideRecord => ({ planId: o.plan_id, date: o.date, dayTypeId: o.day_type_id })),
      observations: obs.map(toObservation),
      quickLogs: qs.map(toQuickLog),
      imports: imports.map((i) => ({ id: i.id, createdAt: i.created_at, extractor: i.extractor, assets: JSON.parse(i.assets_json) })),
    };
  }

  async restore(s: StoreSnapshot): Promise<void> {
    await this.transaction(async () => {
      for (const p of s.plans) await this.setActivePlan(p);
      for (const a of s.activityLogs) await this.upsertActivity(a);
      for (const o of s.dayOverrides) await this.setDayOverride(o.planId, o.date, o.dayTypeId);
      for (const i of s.imports) await this.upsertImport(i);
      for (const o of s.observations) await this.upsertObservation(o);
      for (const q of s.quickLogs) await this.addQuickLog(q);
      for (const c of s.configChanges ?? []) await this.insertConfigChange(c);
      for (const e of s.completionEvents ?? []) await this.insertEvent(e);
      for (const d of s.daySnapshots ?? []) await this.upsertDaySnapshot(d);
    });
  }
}
