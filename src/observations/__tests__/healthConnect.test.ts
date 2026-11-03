import { KJ_PER_KCAL } from '../../energy';
import { HC_IMPORT_ID, appForOrigin, dedupeSessions, exerciseLabel, mapHealthConnect, syncDates, type HcRead, type HcSession } from '../healthConnect';

const AT = '2026-11-03T07:42:00+11:00';
// Times below carry the local offset, so the local date is the ISO date.
const localDateOf = (iso: string) => iso.slice(0, 10);
const days = syncDates('2026-11-03', false);
const map = (read: HcRead) => mapHealthConnect(read, days, AT, localDateOf);
const SAMSUNG = 'com.sec.android.app.shealth';
const FITBIT = 'com.fitbit.FitbitMobile';

describe('Health Connect sync window (#36)', () => {
  it('re-reads the last 7 days, 30 on the first sync, ending today', () => {
    expect(days).toEqual(['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
    const first = syncDates('2026-11-03', true);
    expect(first).toHaveLength(30);
    expect(first[0]).toBe('2026-10-05');
    expect(first[29]).toBe('2026-11-03');
  });
});

describe('mapping Health Connect data to observations (#36)', () => {
  it('daily steps and active energy (kcal → kJ), with the source app and deterministic ids', () => {
    const { observations, metrics } = map({
      steps: [{ date: '2026-11-03', value: 6214, origins: [SAMSUNG] }],
      activeKcal: [{ date: '2026-11-03', value: 320, origins: [SAMSUNG] }],
    });
    expect(metrics).toEqual(['steps', 'active_energy']);
    expect(observations.map((o) => [o.id, o.metric, o.value, o.unit, o.source.app])).toEqual([
      ['hc:active_energy:2026-11-03', 'active_energy', 320 * KJ_PER_KCAL, 'kJ', 'samsung-health'],
      ['hc:steps:2026-11-03', 'steps', 6214, 'count', 'samsung-health'],
    ]);
    for (const o of observations) {
      expect(o.source).toMatchObject({ type: 'integration', importId: HC_IMPORT_ID, edited: false });
      expect(o.kind).toBe('observed');
      expect(o.recordedAt).toBe(AT);
    }
  });

  it('a type that was not read is not in `metrics`, so its stored records are left alone', () => {
    expect(map({ weight: [] }).metrics).toEqual(['weight']);
    expect(map({}).metrics).toEqual([]);
  });

  it('days outside the window and zero totals produce nothing', () => {
    const { observations } = map({
      steps: [
        { date: '2026-10-01', value: 9000, origins: [SAMSUNG] },
        { date: '2026-11-02', value: 0, origins: [] },
      ],
    });
    expect(observations).toEqual([]);
  });

  it('weight: one per day, the latest weigh-in, from the app that recorded it', () => {
    const { observations } = map({
      weight: [
        { id: 'w1', time: '2026-11-03T06:58:00+11:00', kg: 82.4, origin: 'com.withings.wiscale2' },
        { id: 'w2', time: '2026-11-03T21:10:00+11:00', kg: 83.04, origin: SAMSUNG },
        { id: 'w3', time: '2026-11-02T07:00:00+11:00', kg: 82.9, origin: 'com.withings.wiscale2' },
      ],
    });
    expect(observations.map((o) => [o.id, o.value, o.source.app, o.source.capturedAt])).toEqual([
      ['hc:weight:2026-11-02', 82.9, 'withings', '2026-11-02T07:00:00+11:00'],
      ['hc:weight:2026-11-03', 83.04, 'samsung-health', '2026-11-03T21:10:00+11:00'],
    ]);
  });

  it('workouts: one observation per session, labelled by title or type; the same workout from two apps counts once', () => {
    const walkSamsung: HcSession = { id: 'e1', start: '2026-11-03T08:30:00+11:00', end: '2026-11-03T09:02:00+11:00', origin: SAMSUNG, exerciseType: 79 };
    const walkFitbit: HcSession = { id: 'e2', start: '2026-11-03T08:31:00+11:00', end: '2026-11-03T09:00:00+11:00', origin: FITBIT, exerciseType: 79 };
    const gym: HcSession = { id: 'e3', start: '2026-11-03T18:00:00+11:00', end: '2026-11-03T18:35:00+11:00', origin: FITBIT, exerciseType: 70, title: 'Upper body' };
    const { observations } = map({ exercise: [walkFitbit, gym, walkSamsung] });
    expect(observations.map((o) => [o.id, o.label, o.value, o.source.app])).toEqual([
      ['hc:exercise:e1', 'Walk', 32, 'samsung-health'], // the longer of the two duplicates
      ['hc:exercise:e3', 'Upper body', 35, 'fitbit'],
    ]);
  });

  it('two sessions from the same app are both kept, even when they touch', () => {
    const a: HcSession = { id: 'a', start: '2026-11-03T08:00:00+11:00', end: '2026-11-03T08:30:00+11:00', origin: FITBIT, exerciseType: 56 };
    const b: HcSession = { id: 'b', start: '2026-11-03T08:20:00+11:00', end: '2026-11-03T08:40:00+11:00', origin: FITBIT, exerciseType: 79 };
    expect(dedupeSessions([a, b]).map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('sleep: belongs to the wake-up day; asleep stages only; two apps recording the same night are merged, not added', () => {
    const night: HcSession = {
      id: 's1',
      start: '2026-11-02T22:30:00+11:00',
      end: '2026-11-03T06:30:00+11:00',
      origin: SAMSUNG,
      stages: [
        { start: '2026-11-02T22:30:00+11:00', end: '2026-11-02T22:50:00+11:00', stage: 1 }, // awake
        { start: '2026-11-02T22:50:00+11:00', end: '2026-11-03T02:00:00+11:00', stage: 4 }, // light
        { start: '2026-11-03T02:00:00+11:00', end: '2026-11-03T02:15:00+11:00', stage: 3 }, // out of bed
        { start: '2026-11-03T02:15:00+11:00', end: '2026-11-03T06:30:00+11:00', stage: 5 }, // deep
      ],
    };
    // The watch app saw the same night without stages; its span lies inside the stage-based one.
    const sameNight: HcSession = { id: 's2', start: '2026-11-02T23:00:00+11:00', end: '2026-11-03T06:00:00+11:00', origin: FITBIT };
    const { observations } = map({ sleep: [night, sameNight] });
    expect(observations).toHaveLength(1);
    const o = observations[0];
    expect(o.id).toBe('hc:sleep:2026-11-03');
    expect(o.date).toBe('2026-11-03');
    // 22:50–06:30 is 460 min; 02:00–02:15 out of bed is covered by the watch session (23:00–06:00), so the union is 460.
    expect(o.value).toBe(460);
    expect(o.source.app).toBe('samsung-health'); // the longest session's app
  });

  it('a stage-less session counts its whole length', () => {
    const { observations } = map({ sleep: [{ id: 's', start: '2026-11-02T23:00:00+11:00', end: '2026-11-03T06:45:00+11:00', origin: FITBIT }] });
    expect(observations[0].value).toBe(465);
  });

  it('labels and app names', () => {
    expect(exerciseLabel(79)).toBe('Walk');
    expect(exerciseLabel(70)).toBe('Strength training');
    expect(exerciseLabel(999)).toBe('Workout');
    expect(exerciseLabel(undefined)).toBe('Workout');
    expect(appForOrigin(SAMSUNG)).toBe('samsung-health');
    expect(appForOrigin('com.example.tracker')).toBe('com.example.tracker');
    expect(appForOrigin(undefined)).toBeNull();
  });

  it('mapping the same read twice gives identical observations (a re-sync replaces, never duplicates)', () => {
    const read: HcRead = { steps: [{ date: '2026-11-03', value: 6214, origins: [SAMSUNG] }], weight: [{ id: 'w', time: '2026-11-03T07:00:00+11:00', kg: 82.4, origin: SAMSUNG }] };
    expect(map(read)).toEqual(map(read));
  });
});
