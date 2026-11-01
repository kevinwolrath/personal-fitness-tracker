import type {
  ActivityLog,
  DayRecords,
  MeasurementEntry,
  QuickLogEntry,
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
   CREATE TABLE measurement (
     id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, measurement_id TEXT NOT NULL,
     date TEXT NOT NULL, value REAL NOT NULL, recorded_at TEXT NOT NULL);
   CREATE INDEX measurement_lookup ON measurement (plan_id, measurement_id, date);
   CREATE TABLE quick_log (
     id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, quick_log_id TEXT NOT NULL,
     date TEXT NOT NULL, at TEXT NOT NULL);
   CREATE INDEX quick_log_day ON quick_log (plan_id, date);
   CREATE TABLE day_override (
     plan_id TEXT NOT NULL, date TEXT NOT NULL, day_type_id TEXT NOT NULL,
     PRIMARY KEY (plan_id, date));`,
];

export async function migrate(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (let v = current; v < migrations.length; v++) {
    await db.execAsync(`BEGIN; ${migrations[v]} PRAGMA user_version = ${v + 1}; COMMIT;`);
  }
}

type MeasurementRow = { id: string; plan_id: string; measurement_id: string; date: string; value: number; recorded_at: string };
const toMeasurement = (r: MeasurementRow): MeasurementEntry => ({
  id: r.id,
  planId: r.plan_id,
  measurementId: r.measurement_id,
  date: r.date,
  value: r.value,
  recordedAt: r.recorded_at,
});

export class SqliteTrackingStore implements TrackingStore {
  private constructor(private db: SqlDatabase) {}

  static async open(db: SqlDatabase): Promise<SqliteTrackingStore> {
    await migrate(db);
    return new SqliteTrackingStore(db);
  }

  async getActivePlan(): Promise<StoredPlan | null> {
    const r = await this.db.getFirstAsync<{ plan_id: string; revision: number; format_version: number; json: string; imported_at: string }>(
      'SELECT plan_id, revision, format_version, json, imported_at FROM plan WHERE id = 1',
      [],
    );
    return r && { planId: r.plan_id, revision: r.revision, formatVersion: r.format_version, json: r.json, importedAt: r.imported_at };
  }

  async setActivePlan(p: StoredPlan): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO plan (id, plan_id, revision, format_version, json, imported_at) VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET plan_id = excluded.plan_id, revision = excluded.revision,
         format_version = excluded.format_version, json = excluded.json, imported_at = excluded.imported_at`,
      [p.planId, p.revision, p.formatVersion, p.json, p.importedAt],
    );
  }

  async getDay(planId: string, date: string): Promise<DayRecords> {
    const [acts, override, ms, qs] = await Promise.all([
      this.db.getAllAsync<{ activity_id: string; status: ActivityLog['status']; count: number; label_snapshot: string; updated_at: string }>(
        'SELECT activity_id, status, count, label_snapshot, updated_at FROM activity_log WHERE plan_id = ? AND date = ?',
        [planId, date],
      ),
      this.db.getFirstAsync<{ day_type_id: string }>('SELECT day_type_id FROM day_override WHERE plan_id = ? AND date = ?', [planId, date]),
      this.db.getAllAsync<MeasurementRow>(
        'SELECT * FROM measurement WHERE plan_id = ? AND date = ? ORDER BY recorded_at',
        [planId, date],
      ),
      this.db.getAllAsync<{ id: string; plan_id: string; quick_log_id: string; date: string; at: string }>(
        'SELECT * FROM quick_log WHERE plan_id = ? AND date = ? ORDER BY at',
        [planId, date],
      ),
    ]);
    return {
      activities: Object.fromEntries(
        acts.map((a) => [
          a.activity_id,
          { activityId: a.activity_id, status: a.status, count: a.count, labelSnapshot: a.label_snapshot, updatedAt: a.updated_at },
        ]),
      ),
      dayTypeOverride: override?.day_type_id ?? null,
      measurements: ms.map(toMeasurement),
      quickLogs: qs.map((q) => ({ id: q.id, planId: q.plan_id, quickLogId: q.quick_log_id, date: q.date, at: q.at })),
    };
  }

  async setActivity(planId: string, date: string, activityId: string, log: ActivityLog | null): Promise<void> {
    if (!log) {
      await this.db.runAsync('DELETE FROM activity_log WHERE plan_id = ? AND date = ? AND activity_id = ?', [planId, date, activityId]);
      return;
    }
    await this.db.runAsync(
      `INSERT INTO activity_log (plan_id, date, activity_id, status, count, label_snapshot, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(plan_id, date, activity_id) DO UPDATE SET status = excluded.status, count = excluded.count,
         label_snapshot = excluded.label_snapshot, updated_at = excluded.updated_at`,
      [planId, date, activityId, log.status, log.count, log.labelSnapshot, log.updatedAt],
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

  async addMeasurement(m: MeasurementEntry): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO measurement (id, plan_id, measurement_id, date, value, recorded_at) VALUES (?, ?, ?, ?, ?, ?)',
      [m.id, m.planId, m.measurementId, m.date, m.value, m.recordedAt],
    );
  }

  async removeMeasurement(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM measurement WHERE id = ?', [id]);
  }

  async latestMeasurement(planId: string, measurementId: string, onOrBefore: string): Promise<MeasurementEntry | null> {
    const r = await this.db.getFirstAsync<MeasurementRow>(
      `SELECT * FROM measurement WHERE plan_id = ? AND measurement_id = ? AND date <= ?
       ORDER BY date DESC, recorded_at DESC LIMIT 1`,
      [planId, measurementId, onOrBefore],
    );
    return r ? toMeasurement(r) : null;
  }

  async addQuickLog(q: QuickLogEntry): Promise<void> {
    await this.db.runAsync('INSERT INTO quick_log (id, plan_id, quick_log_id, date, at) VALUES (?, ?, ?, ?, ?)', [
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
}
