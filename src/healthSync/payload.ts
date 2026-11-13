import { buildAiExport, type AiExport, type DatabaseStart } from '../export/aiExport';
import { projectExport, shareCategories, type ProjectionScope, type ShareCategory, type ShareRange as Range } from '../export/shareProjection';
import type { LocalDate } from '../plan/dates';
import type { StoreSnapshot } from '../storage/types';

/**
 * What Body Anvil syncs and shares (#134, #163, #171): the detailed AI export (`body-anvil-ai-export` version 2,
 * src/export/aiExport.ts) is the sync snapshot (`schemaVersion: 2`, questspirestudio docs/body-anvil/SYNC_API.md
 * "Snapshot v2"). One schema: the file Advanced sharing makes, the server copy and what links return are the same
 * document (links scoped by period and categories). It states its coverage by source (app records vs Health Connect),
 * when this database started, food completeness and every record's provenance.
 *
 * Never included: the display name, photos or any image, notes, screenshot text, location (none recorded), credentials.
 * The Worker rejects any field it doesn't know.
 */

/** The Worker's limits (worker/snapshot.mjs, worker/export.mjs). */
export const MAX_RECORDS = 15_000;
export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

export const categories = shareCategories;
export type Category = ShareCategory;
export type ShareRange = Range;
export type Scope = Pick<ProjectionScope, 'range' | 'categories'>;
export const categoryLabels: Record<Category, { label: string; detail: string }> = {
  measurements: { label: 'Body measurements', detail: 'Weight, waist, body fat and your own measurements' },
  activity: { label: 'Activity', detail: 'Steps, distance, active energy and minutes' },
  sleep: { label: 'Sleep', detail: 'Time asleep, sleep and readiness scores' },
  nutrition: { label: 'Food', detail: 'Meals eaten and planned, by day, with what’s missing' },
  training: { label: 'Training', detail: 'Workouts, exercises, sets, reps and loads' },
  plan: { label: 'Plan targets', detail: 'Energy and protein targets, weight goal' },
};

export const OMITTED = [
  'Your name',
  'Notes, meal photos and screenshots',
  'Location: the app records none',
  'Passwords, keys and the link credential',
] as const;

export type SyncSnapshot = AiExport;

export type SnapshotMeta = { generatedAt: string; timezone: string; today: LocalDate; appVersion: string; databaseStart: DatabaseStart | null };

/** The sync snapshot: the detailed export of everything the phone holds. */
export const buildSnapshot = (s: StoreSnapshot, meta: SnapshotMeta): SyncSnapshot => buildAiExport(s, meta);

/** A numeric `major.minor.patch` (the Worker rejects anything else). */
export const wireVersion = (v: string) => (/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(v) ? v : '0.0.0');

/** What a link with this scope shows, worked out on the phone exactly as the Worker does ("records" format). */
export const projectShare = (snapshot: SyncSnapshot, scope: Scope) => projectExport(snapshot, { ...scope, format: 'records' });

/** UTF-8 byte length of a string (no TextEncoder dependency). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
