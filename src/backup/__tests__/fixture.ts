/** #128 A realistic, entirely fictional history for backup round-trip tests. Never real health data. */
import { randomBytes } from 'node:crypto';
import seed from '../../../plans/seed.plan.json';
import { journeySnapshot } from '../../../fixtures/gamification/journey';
import { applyConfigUpdate, parseConfigUpdate } from '../../config/update';
import type { MealLog } from '../../nutrition/contract';
import { observation } from '../../../fixtures/gamification/journey';
import type { StoreSnapshot } from '../../storage/types';
import type { BackupIO } from '../service';

/** In-memory device: attachment files and preferences, with optional injected failures. */
export class MemoryDevice implements BackupIO {
  files = new Map<string, Uint8Array>();
  prefs = new Map<string, string>();
  free: number | null = null;
  failWriteAt: number | null = null;
  writes = 0;
  constructor(private root: string) {}
  async readAttachment(uri: string) {
    return this.files.get(uri) ?? null;
  }
  async writeAttachment(restoreId: string, path: string, bytes: Uint8Array) {
    this.writes++;
    if (this.failWriteAt !== null && this.writes >= this.failWriteAt) throw new Error('No space left on device (storage full)');
    const uri = `${this.root}restore-${restoreId}/${path.replace(/^attachments\//, '')}`;
    this.files.set(uri, new Uint8Array(bytes));
    return uri;
  }
  async removeAttachments(uris: string[]) {
    for (const u of uris) this.files.delete(u);
  }
  async freeBytes() {
    return this.free;
  }
  async getPreference(key: string) {
    return this.prefs.get(key) ?? null;
  }
  async setPreference(key: string, value: string | null) {
    if (value === null) this.prefs.delete(key);
    else this.prefs.set(key, value);
  }
}

const photoBytes = (n: number) => {
  // A JPEG-looking file of random bytes: content is irrelevant, bytes must survive exactly.
  const b = new Uint8Array(randomBytes(n));
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff;
  return b;
};

/** History across months: journey activity, plan versions via config changes, muscle growth, meals with photos, imports. */
export function richHistory(device: MemoryDevice): StoreSnapshot {
  const s = journeySnapshot(60);
  // Plan versions: the seed, then a configuration change (custom exercise + Muscle Growth, formatVersion 8).
  const update = parseConfigUpdate(JSON.stringify({ fitnessConfigUpdate: { schemaVersion: 1, exercise: {
    customExercises: [{ movement: 'dumbbell_shrug', name: 'Dumbbell shrug', equipment: ['free_weights'], primary: ['upper_back'], secondary: ['forearms'], guidance: ['Up, pause, down slowly.'] }],
    muscleGrowth: { enabled: true, targets: ['biceps', 'upper_back'], exercises: [{ movement: 'hammer_curl', sets: 3, reps: 12, loadKg: 10 }, { movement: 'dumbbell_shrug' }], days: ['mon', 'wed', 'fri'], when: 'lunch' },
  } } }));
  if (!update.ok) throw new Error(update.errors.join('\n'));
  const applied = applyConfigUpdate(JSON.parse(JSON.stringify(seed)), update.update);
  if (!applied.ok) throw new Error(applied.errors.join('\n'));
  s.plans = [{ planId: (seed as any).id, revision: applied.nextRaw.revision as number, formatVersion: 8, json: JSON.stringify(applied.nextRaw), importedAt: '2026-08-01T10:00:00.000Z', origin: 'config' }];
  s.configChanges = [{ id: 'cfg-1', appliedAt: '2026-08-01T10:00:00.000+10:00', sections: ['exercise'], payload: update.json, fromRevision: (seed as any).revision, toRevision: applied.nextRaw.revision as number, previousPlanJson: JSON.stringify(seed) }];
  // Muscle Growth: done with load and RIR, and an explicit skip.
  s.exerciseLogs!.push(
    { id: 'mg-2026-08-03-hammer_curl', movement: 'hammer_curl', date: '2026-08-03', at: '2026-08-03T12:30:00+10:00', sets: 3, reps: 12, seconds: null, intensity: 'moderate', routine: 'muscle_growth', status: 'done', loadKg: 10, rir: 2 },
    { id: 'mg-2026-08-03-dumbbell_shrug', movement: 'dumbbell_shrug', date: '2026-08-03', at: '2026-08-03T12:40:00+10:00', sets: 0, reps: null, seconds: null, intensity: null, routine: 'muscle_growth', status: 'skipped' },
  );
  s.dayOverrides = [{ planId: (seed as any).id, date: '2026-08-07', dayTypeId: (seed as any).dayTypes[0].id }];
  s.completionEvents = [
    { id: 'ev-1', planId: (seed as any).id, date: '2026-08-07', activityId: 'resistance', requirementId: null, action: 'tick', count: 0, variant: 'full', label: 'Goblet squat', purpose: 'strength', at: '2026-08-07T18:00:00+10:00' },
    { id: 'ev-2', planId: (seed as any).id, date: '2026-08-07', activityId: 'walk', requirementId: null, action: 'skip', count: 0, variant: null, label: 'Walk', purpose: null, at: '2026-08-07T19:00:00+10:00' },
  ];
  s.daySnapshots = [{ planId: (seed as any).id, date: '2026-08-07', planRevision: 2, prescribed: { items: [{ key: 'resistance', session: { exercises: [{ movement: 'kettlebell_squat', sets: 3, reps: 10 }] } }] }, updatedAt: '2026-08-07T19:00:00+10:00' }];
  s.muscleReports = [{ id: 'sore-1', muscle: 'biceps', kind: 'sore', at: '2026-08-04T08:00:00+10:00', clearedAt: '2026-08-06T08:00:00+10:00' }];
  // Imported (integration) steps with provenance, and a screenshot import with a retained asset.
  s.observations.push({ ...observation('steps', 8123, '2026-08-02', 'hc-steps-2026-08-02'), source: { type: 'integration', app: 'health-connect', capturedAt: null, confidence: null, importId: 'health-connect', assetId: null, evidence: null, edited: false } });
  s.imports = [{ id: 'imp-1', createdAt: '2026-08-05T09:00:00+10:00', extractor: 'manual-test', assets: [{ id: 'asset-1', fileName: 'scale.png', mimeType: 'image/png', capturedAt: null, storedUri: 'file:///old/imports/imp-1/asset-1.png', sourceApp: 'scale-app' }] }];
  s.observations.push({ ...observation('weight', 96.4, '2026-08-05', 'ss-weight-2026-08-05'), source: { type: 'screenshot', app: 'scale-app', capturedAt: '2026-08-05T07:00:00+10:00', confidence: 0.92, importId: 'imp-1', assetId: 'asset-1', evidence: '96.4 kg', edited: false } });
  device.files.set('file:///old/imports/imp-1/asset-1.png', photoBytes(40_000));
  // Meals with several real photo files.
  const meal = (id: string, date: string, photos: number): MealLog => ({
    id, date, at: `${date}T12:15:00+10:00`, planId: null, activityId: null, replacedLabel: null, name: `Lunch ${id}`,
    items: [{ name: 'Chicken salad', quantity: 1, unit: 'bowl', energyKj: 2100, proteinG: 38, carbsG: 20, fatG: 22 }],
    aiTotals: null, confidence: 'medium', assumptions: ['standard bowl'], uncertainties: [], source: 'photo-ai', schemaVersion: 1, edited: true,
    photos: Array.from({ length: photos }, (_, i) => ({ id: `${id}-p${i}`, uri: `file:///old/meal-photos/${id}-p${i}.jpg`, addedAt: `${date}T12:10:00+10:00`, width: 1200, height: 900 })),
    recordedAt: `${date}T12:20:00+10:00`, updatedAt: `${date}T12:21:00+10:00`,
  });
  s.mealLogs = [meal('m1', '2026-07-20', 2), meal('m2', '2026-08-02', 1), meal('m3', '2026-08-05', 3)];
  for (const m of s.mealLogs) for (const p of m.photos) device.files.set(p.uri, photoBytes(50_000 + p.id.length * 1000));
  device.prefs.set('pft.gamification.v1', JSON.stringify({ enabled: true, celebrated: ['achievement:first'] }));
  device.prefs.set('pft.display.theme', 'hero-forge');
  device.prefs.set('pft.display.energy', 'kcal');
  device.prefs.set('pft.anthropic.apiKey', 'sk-test-not-real');
  device.prefs.set('pft.healthConnect.sync', JSON.stringify({ at: 'x', ok: true, days: 7, failed: [], firstDone: true }));
  return s;
}
