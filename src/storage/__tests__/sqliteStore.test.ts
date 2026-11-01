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
});

it('migrations are idempotent and set user_version', async () => {
  const db = nodeSqlite(new DatabaseSync(':memory:'));
  await migrate(db);
  await migrate(db);
  expect(await db.getFirstAsync('PRAGMA user_version', [])).toEqual({ user_version: 1 });
});
