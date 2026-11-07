/**
 * Runs the shared store suite against the real SQL used on Android/iOS,
 * via Node's built-in SQLite behind the expo-sqlite-shaped SqlDatabase interface.
 */
import { DatabaseSync } from 'node:sqlite';
import { migrate, SqliteTrackingStore, type SqlDatabase } from '../sqliteStore';
import { describeTrackingStore } from './store.contract';

function nodeSqlite(db: DatabaseSync): SqlDatabase {
  return {
    async execAsync(sql) {
      db.exec(sql);
    },
    async runAsync(sql, params) {
      return db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: (string | number | null)[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T>(sql: string, params: (string | number | null)[]) {
      return (db.prepare(sql).get(...params) as T | undefined) ?? null;
    },
  };
}

describeTrackingStore('SQLite (native)', async () => {
  const db = nodeSqlite(new DatabaseSync(':memory:'));
  return { store: await SqliteTrackingStore.open(db), reopen: () => SqliteTrackingStore.open(db) };
}, () => SqliteTrackingStore.open(nodeSqlite(new DatabaseSync(':memory:'))));

it('migrations are idempotent and set user_version', async () => {
  const db = nodeSqlite(new DatabaseSync(':memory:'));
  await migrate(db);
  await migrate(db);
  expect(await db.getFirstAsync('PRAGMA user_version', [])).toEqual({ user_version: 5 });
});

it('migrates an existing version-1 database without losing data (plan becomes origin "seed")', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = nodeSqlite(raw);
  // Exactly the schema shipped in migration 1 (develop before #7), with data in it.
  raw.exec(`CREATE TABLE plan (id INTEGER PRIMARY KEY CHECK (id = 1), plan_id TEXT NOT NULL, revision INTEGER NOT NULL,
      format_version INTEGER NOT NULL, json TEXT NOT NULL, imported_at TEXT NOT NULL);
    CREATE TABLE activity_log (plan_id TEXT NOT NULL, date TEXT NOT NULL, activity_id TEXT NOT NULL, status TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0, label_snapshot TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (plan_id, date, activity_id));
    CREATE TABLE observation (id TEXT PRIMARY KEY, date TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL, unit TEXT NOT NULL,
      kind TEXT NOT NULL, label TEXT, note TEXT, source_type TEXT NOT NULL, source_app TEXT, captured_at TEXT, confidence REAL,
      import_id TEXT, asset_id TEXT, evidence TEXT, edited INTEGER NOT NULL DEFAULT 0, recorded_at TEXT NOT NULL);
    CREATE TABLE import_session (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, extractor TEXT NOT NULL, assets_json TEXT NOT NULL);
    CREATE TABLE quick_log (id TEXT PRIMARY KEY, plan_id TEXT NOT NULL, quick_log_id TEXT NOT NULL, date TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE day_override (plan_id TEXT NOT NULL, date TEXT NOT NULL, day_type_id TEXT NOT NULL, PRIMARY KEY (plan_id, date));
    INSERT INTO plan VALUES (1, 'p', 3, 1, '{"id":"p"}', 't');
    INSERT INTO activity_log VALUES ('p', '2026-10-01', 'walk', 'done', 0, 'Walk', 't');
    PRAGMA user_version = 1;`);
  const store = await SqliteTrackingStore.open(db);
  expect(await store.getActivePlan()).toEqual({ planId: 'p', revision: 3, formatVersion: 1, json: '{"id":"p"}', importedAt: 't', origin: 'seed' });
  expect((await store.getDay('p', '2026-10-01')).activities.walk.status).toBe('done');
  expect(await store.configHistory()).toEqual([]);
  expect(await store.completionEvents('p', '2026-10-01')).toEqual([]);
  expect((await store.getDay('p', '2026-10-01')).activities.walk).toEqual({ activityId: 'walk', status: 'done', count: 0, labelSnapshot: 'Walk', updatedAt: 't' });
  expect(await db.getFirstAsync('PRAGMA user_version', [])).toEqual({ user_version: 5 });
});

it('migrates a version-3 database (before #28): exercise ticks are additive, nothing is lost', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = nodeSqlite(raw);
  // Run migrations 1–3 exactly as shipped, then stop at version 3 with data in it.
  await migrate(db);
  raw.exec(`DROP TABLE exercise_log; DROP TABLE muscle_report; ALTER TABLE activity_log DROP COLUMN exercises_done; PRAGMA user_version = 3;`);
  raw.exec(`INSERT INTO activity_log (plan_id, date, activity_id, status, count, label_snapshot, updated_at, variant)
    VALUES ('p', '2026-10-01', 'resistance', 'done', 0, 'Strength workout', 't', 'short');`);
  const store = await SqliteTrackingStore.open(db);
  expect(await db.getFirstAsync('PRAGMA user_version', [])).toEqual({ user_version: 5 });
  expect((await store.getDay('p', '2026-10-01')).activities.resistance).toEqual({
    activityId: 'resistance', status: 'done', count: 0, labelSnapshot: 'Strength workout', updatedAt: 't', variant: 'short',
  });
  await store.setActivity('p', '2026-10-02', 'resistance', {
    activityId: 'resistance', status: 'pending', count: 0, labelSnapshot: 'Strength workout', updatedAt: 't', variant: 'full', exercisesDone: ['full:0:kettlebell_squat'],
  });
  expect((await store.getDay('p', '2026-10-02')).activities.resistance.exercisesDone).toEqual(['full:0:kettlebell_squat']);
});

it('migrates a version-4 database (before #56): exercise logs and muscle reports are new tables, nothing is lost', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = nodeSqlite(raw);
  // Run migrations 1–4 exactly as shipped, then stop at version 4 with data in every older table.
  await migrate(db);
  raw.exec(`DROP TABLE exercise_log; DROP TABLE muscle_report; PRAGMA user_version = 4;`);
  raw.exec(`INSERT INTO activity_log (plan_id, date, activity_id, status, count, label_snapshot, updated_at, variant, exercises_done)
    VALUES ('p', '2026-10-01', 'resistance', 'pending', 0, 'Strength workout', 't', 'full', '["full:0:kettlebell_squat"]');
    INSERT INTO completion_event (id, plan_id, date, activity_id, requirement_id, action, count, variant, label, purpose, at)
    VALUES ('e1', 'p', '2026-10-01', 'resistance', NULL, 'tick', 0, 'full', 'Kettlebell squat', 'strength', 't');
    INSERT INTO quick_log (id, plan_id, quick_log_id, date, at) VALUES ('q', 'p', 'hunger', '2026-09-30', 't');`);
  const before = await (await SqliteTrackingStore.open(nodeSqlite(raw))).snapshot();
  expect(await db.getFirstAsync('PRAGMA user_version', [])).toEqual({ user_version: 5 });
  const store = await SqliteTrackingStore.open(db);
  expect((await store.getDay('p', '2026-10-01')).activities.resistance.exercisesDone).toEqual(['full:0:kettlebell_squat']);
  expect(await store.completionEvents('p', '2026-10-01')).toHaveLength(1);
  expect(before.exerciseLogs).toEqual([]);
  expect(before.muscleReports).toEqual([]);
  await store.addExerciseLog({ id: 'x', movement: 'plank', date: '2026-10-02', at: 't2', sets: 2, reps: null, seconds: 30, intensity: null });
  await store.addMuscleReport({ id: 'r', muscle: 'chest', kind: 'sore', at: 't3', clearedAt: null });
  expect(await store.exerciseLogs()).toHaveLength(1);
  expect(await store.muscleReports()).toHaveLength(1);
  expect(await store.firstRecordDate()).toBe('2026-09-30');
});
