import seed from '../../../plans/seed.plan.json';
import { MemoryDevice, richHistory } from '../../backup/__tests__/fixture';
import type { MealLog } from '../../nutrition/contract';
import type { Observation } from '../../observations/types';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../storage/keyValueStore';
import type { StoreSnapshot } from '../../storage/types';
import { AI_EXPORT_FORMAT, AI_EXPORT_VERSION, buildAiExport, DATABASE_START_KEY, databaseStart, noteDatabaseStart } from '../aiExport';

/**
 * #167: the detailed AI export states its coverage, so a reset database (app records start late) and older Health
 * Connect history are never read as missed logging; it keeps eaten apart from planned, and keeps every reading.
 * Fictional data only.
 */

const TODAY = '2026-11-12';
const base = richHistory(new MemoryDevice('file:///app/'));
const planId = base.plans[0].planId;
const src = (type: 'manual' | 'integration' | 'screenshot', app: string | null = null) => ({ type, app, capturedAt: null, confidence: null, importId: null, assetId: null, evidence: null, edited: false });
const obs = (id: string, date: string, metric: string, value: number, type: 'manual' | 'integration' = 'manual', recordedAt = `${date}T07:00:00+11:00`): Observation =>
  ({ id, date, metric, value, unit: metric === 'weight' ? 'kg' : metric === 'energy_intake' ? 'kJ' : 'count', kind: 'observed', label: null, note: null, source: src(type, type === 'integration' ? 'samsung' : null), recordedAt }) as Observation;
const meal = (id: string, date: string, energyKj: number | null, proteinG: number | null, replaces: string | null = null): MealLog => ({
  id, date, at: `${date}T19:00:00+11:00`, planId: replaces ? planId : null, activityId: replaces, replacedLabel: replaces, name: `Meal ${id}`,
  items: [{ name: id, quantity: 1, unit: 'serve', energyKj, proteinG, carbsG: null, fatG: null }],
  aiTotals: null, confidence: null, assumptions: [], uncertainties: [], source: 'manual', schemaVersion: null, edited: false,
  photos: [{ id: 'p1', uri: 'file:///app/meal-photos/p1.jpg', width: 1, height: 1 } as never], recordedAt: `${date}T19:05:00+11:00`, updatedAt: `${date}T19:05:00+11:00`,
});
const tick = (date: string, activityId: string, status: 'done' | 'skipped' = 'done') => ({ planId, date, activityId, status, count: 0, labelSnapshot: activityId, updatedAt: `${date}T12:00:00Z` });

/** A database reset on 2026-11-08: Health Connect still has October; the app's own records start on the 8th. */
function resetHistory(): StoreSnapshot {
  return {
    ...base,
    observations: [
      obs('hc-steps-oct', '2026-10-01', 'steps', 9000, 'integration'),
      obs('hc-weight-oct', '2026-10-02', 'weight', 95, 'integration'),
      obs('w1', '2026-11-08', 'weight', 92.4),
      obs('w2', '2026-11-08', 'weight', 92.1, 'manual', '2026-11-08T21:00:00+11:00'), // a second reading the same day
      obs('steps-zero', '2026-11-09', 'steps', 0), // a real zero
    ],
    activityLogs: [tick('2026-11-08', 'lunch'), tick('2026-11-09', 'snack'), tick('2026-11-10', 'lunch', 'skipped')],
    mealLogs: [meal('dinner-8', '2026-11-08', 3000, 30), meal('unknown-9', '2026-11-09', null, 10), meal('swap-10', '2026-11-10', 2000, 40, 'lunch')],
    exerciseLogs: [{ id: 'mg-2026-11-09-hammer_curl', date: '2026-11-09', at: '2026-11-09T12:00:00+11:00', movement: 'hammer_curl', sets: 3, reps: 12, seconds: null, intensity: null, loadKg: 10, rir: 2, routine: 'muscle_growth', status: 'done' } as never],
  };
}
const meta = { generatedAt: '2026-11-12T10:00:00+11:00', timezone: 'Australia/Melbourne', today: TODAY, appVersion: '0.1.0', databaseStart: { at: '2026-11-08T08:00:00+11:00', kind: 'created' as const } };

describe('coverage: a reset database next to older Health Connect history', () => {
  const doc = buildAiExport(resetHistory(), meta);

  it('is versioned and says when, where and in which units it was made', () => {
    expect(doc).toMatchObject({ format: AI_EXPORT_FORMAT, version: AI_EXPORT_VERSION, generatedAt: meta.generatedAt, timezone: 'Australia/Melbourne', units: expect.objectContaining({ mass: 'kg', energy: expect.stringMatching(/^kJ/) }) });
  });

  it('app records and Health Connect have separate coverage; the database start is stated, not inferred', () => {
    expect(doc.coverage).toEqual({ app: { from: '2026-11-08', to: '2026-11-10' }, healthConnect: { from: '2026-10-01', to: '2026-10-02' } });
    expect(doc.database).toMatchObject({ startedAt: meta.databaseStart.at, startedAtKind: 'created', earliestRetainedRecord: '2026-10-01', installSource: null });
    expect(doc.readMe.join(' ')).toMatch(/Do not treat days before that as missed logging/);
  });

  it('days before the app’s own records are not listed as missing food; days within it are', () => {
    expect(doc.food[0].date).toBe('2026-11-08');
    expect(doc.food.find((d) => d.date < '2026-11-08')).toBeUndefined();
    expect(doc.food.find((d) => d.date === '2026-11-11')!.status).toBe('missing');
    expect(doc.food.find((d) => d.date === TODAY)!.status).toBe('in progress');
  });

  it('without a recorded start (older app versions) it says so instead of guessing', () => {
    expect(buildAiExport(resetHistory(), { ...meta, databaseStart: null }).database).toMatchObject({ startedAt: null, startedAtKind: null, earliestRetainedRecord: '2026-10-01' });
  });
});

describe('values: zero, missing and partial', () => {
  const doc = buildAiExport(resetHistory(), meta);
  it('a real zero is kept as 0', () => {
    expect(doc.measurements).toContainEqual(expect.objectContaining({ id: 'steps-zero', value: 0 }));
  });
  it('a day with food of unknown energy is partial; a ticked meal without planned values also', () => {
    const d9 = doc.food.find((d) => d.date === '2026-11-09')!;
    expect(d9.status).toBe('partial');
    expect(d9.loggedMeals).toEqual([expect.objectContaining({ id: 'unknown-9', energyKj: null, proteinG: 10, complete: false })]);
  });
  it('a fully known day is complete', () => {
    expect(doc.food.find((d) => d.date === '2026-11-08')!.status).toBe('complete');
  });
});

describe('food: eaten kept apart from planned, meal by meal', () => {
  const doc = buildAiExport(resetHistory(), meta);
  it('ticked, replaced, skipped and untouched planned meals are distinct; eaten totals count ticked and logged meals only', () => {
    const d8 = doc.food.find((d) => d.date === '2026-11-08')!;
    expect(d8.plannedMeals.find((m) => m.activityId === 'lunch')).toMatchObject({ status: 'eaten (ticked)', plannedEnergyKj: 1780, plannedProteinG: 42 });
    expect(d8.plannedMeals.find((m) => m.activityId === 'snack')!.status).toBe('not ticked');
    expect(d8.eaten).toMatchObject({ energyKj: 3000 + 1780, proteinG: 30 + 42, from: 'meals' });
    const d10 = doc.food.find((d) => d.date === '2026-11-10')!;
    expect(d10.plannedMeals.find((m) => m.activityId === 'lunch')!.status).toBe('replaced');
    expect(d10.eaten.energyKj).toBe(2000); // the replacement, never also the plan's lunch
  });
});

describe('measurements and training', () => {
  const doc = buildAiExport(resetHistory(), meta);
  it('every reading keeps its id, time and source, so duplicates and real repeat readings can be told apart', () => {
    const weights = doc.measurements.filter((m) => m.date === '2026-11-08' && m.metric === 'weight');
    expect(weights.map((w) => [w.id, w.recordedAt])).toEqual([['w1', '2026-11-08T07:00:00+11:00'], ['w2', '2026-11-08T21:00:00+11:00']]);
    expect(doc.measurements.find((m) => m.id === 'hc-weight-oct')!.source).toEqual({ type: 'healthConnect', app: 'samsung', edited: false });
  });
  it('exercises keep their identity, sets, reps, load and effort', () => {
    expect(doc.training.exercises).toEqual([expect.objectContaining({ movement: 'hammer_curl', sets: 3, reps: 12, loadKg: 10, rir: 2, status: 'done' })]);
  });
});

it('never includes the display name, photos or credentials', () => {
  const s = resetHistory();
  const plan = JSON.parse(s.plans[0].json);
  s.plans[0] = { ...s.plans[0], json: JSON.stringify({ ...plan, profile: { ...(plan.profile ?? {}), displayName: 'Fictional Name' } }) };
  const json = JSON.stringify(buildAiExport(s, meta));
  expect(json).not.toContain('Fictional Name');
  expect(json).not.toContain('meal-photos');
});

describe('database start (#167)', () => {
  it('a new database is recorded as created; it is never overwritten later', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await noteDatabaseStart(store, '2026-11-08T08:00:00+11:00');
    await noteDatabaseStart(store, '2026-11-09T08:00:00+11:00');
    expect(await databaseStart(store)).toEqual({ at: '2026-11-08T08:00:00+11:00', kind: 'created' });
  });
  it('a database that already has records is recorded as first seen, never as created', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await store.replaceAll(resetHistory());
    await noteDatabaseStart(store, '2026-11-12T08:00:00+11:00');
    expect(await databaseStart(store)).toEqual({ at: '2026-11-12T08:00:00+11:00', kind: 'firstSeen' });
  });
  it('travels with a full backup (it is database data)', async () => {
    const store = new KeyValueTrackingStore(new MemoryKeyValue());
    await noteDatabaseStart(store, '2026-11-08T08:00:00+11:00');
    const other = new KeyValueTrackingStore(new MemoryKeyValue());
    await other.replaceAll(await store.snapshot());
    expect(await other.getMeta(DATABASE_START_KEY)).toContain('created');
  });
});

it('the seed plan is the one the fixtures use (lunch: 1,780 kJ, 42 g)', () => {
  expect(seed.activities.find((a) => a.id === 'lunch')).toMatchObject({ nutrition: { energy: 1780, protein: 42 } });
});
