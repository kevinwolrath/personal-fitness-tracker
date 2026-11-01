import * as SQLite from 'expo-sqlite';
import { SqliteTrackingStore } from './sqliteStore';
import type { TrackingStore } from './types';

/** Native (Android/iOS): SQLite. See openStore.web.ts for the web backend. */
export async function openStore(): Promise<TrackingStore> {
  const db = await SQLite.openDatabaseAsync('tracking.db');
  return SqliteTrackingStore.open(db);
}
