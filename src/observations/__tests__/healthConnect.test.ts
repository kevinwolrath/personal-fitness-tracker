import { KJ_PER_KCAL } from '../../energy';
import { HC_IMPORT_ID, appForOrigin, appsForOrigins, dedupeSessions, exerciseLabel, mapHealthConnect, summarizeRead, syncDates, type HcRead, type HcSession } from '../healthConnect';

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
      ['hc:exercise:e1', 'Walk', 32, 'samsung-health'],
      ['hc:exercise:e2', 'Walk', 29, 'fitbit'], // raw provenance retained; shared projection deduplicates totals
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

describe('#44: Fitbit weight, source labels, per-type results', () => {
  // Local wall-clock times in whatever zone the test runs in; the default localDateOf is the device's local day.
  const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  const today = '2026-11-05';
  const window7 = syncDates(today, false);

  it('a 7:48 am Fitbit weight read by a 10:54 am sync is imported for that local day', () => {
    const { observations } = mapHealthConnect(
      { weight: [{ id: 'fw', time: local(5, 7, 48), kg: 95.5, origin: 'com.fitbit.FitbitMobile' }] },
      window7,
      local(5, 10, 54),
    );
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ id: 'hc:weight:2026-11-05', date: '2026-11-05', metric: 'weight', value: 95.5, unit: 'kg' });
    expect(observations[0].source).toMatchObject({ type: 'integration', app: 'fitbit', capturedAt: local(5, 7, 48) });
  });

  it('local day, not UTC: an early-morning and a late-evening weigh-in land on their own local days', () => {
    const { observations } = mapHealthConnect(
      {
        weight: [
          { id: 'a', time: local(5, 0, 5), kg: 95.4, origin: 'com.fitbit.FitbitMobile' },
          { id: 'b', time: local(4, 23, 55), kg: 95.9, origin: 'com.fitbit.FitbitMobile' },
        ],
      },
      window7,
      local(5, 10, 54),
    );
    expect(observations.map((o) => [o.date, o.value])).toEqual([
      ['2026-11-04', 95.9],
      ['2026-11-05', 95.4],
    ]);
  });

  it('the window is inclusive: its first day and today are both in; the day before is out', () => {
    expect(window7[0]).toBe('2026-10-30');
    expect(window7[6]).toBe(today);
    const { observations } = mapHealthConnect(
      {
        weight: [
          { id: 'first', time: local(30 - 31, 6), kg: 1, origin: 'x' }, // 30 Oct (day 0 of Nov is 31 Oct)
          { id: 'before', time: local(29 - 31, 6), kg: 1, origin: 'x' }, // 29 Oct
        ],
      },
      window7,
      local(5, 10, 54),
    );
    expect(observations.map((o) => o.date)).toEqual(['2026-10-30']);
  });

  it('the phone’s own recording is "phone"; Fitbit is named; unknown packages are kept raw for the details only', () => {
    expect(appForOrigin('com.android.healthconnect.phone.j26a4212')).toBe('phone');
    expect(appForOrigin('com.google.android.apps.healthdata')).toBe('phone');
    expect(appForOrigin('com.fitbit.FitbitMobile')).toBe('fitbit');
    expect(appForOrigin('com.example.tracker')).toBe('com.example.tracker');
  });

  it('a daily total keeps all its sources: named apps first, then the phone, then unknown apps', () => {
    expect(appsForOrigins(['com.android.healthconnect.phone.j26a4212', 'com.fitbit.FitbitMobile'])).toBe('fitbit,phone');
    expect(appsForOrigins(['com.example.tracker', 'com.android.healthconnect.phone.x', 'com.fitbit.FitbitMobile'])).toBe('fitbit,phone,com.example.tracker');
    expect(appsForOrigins([])).toBeNull();
    const { observations } = mapHealthConnect(
      { steps: [{ date: today, value: 1698, origins: ['com.android.healthconnect.phone.j26a4212', 'com.fitbit.FitbitMobile'] }] },
      window7,
      local(5, 10, 54),
    );
    expect(observations[0].source.app).toBe('fitbit,phone');
  });

  it('per-type results tell "none in Health Connect", "not allowed" and "couldn’t read" apart, with counts and dates only', () => {
    const read: HcRead = {
      steps: [
        { date: today, value: 1698, origins: [] },
        { date: '2026-11-04', value: 0, origins: [] },
      ],
      weight: [], // allowed and read: Health Connect has none
      sleep: [{ id: 's', start: local(4, 23), end: local(5, 6, 47), origin: 'com.fitbit.FitbitMobile' }],
      exercise: [{ id: 'e', start: local(3, 18), end: local(3, 18, 30), origin: 'x' }],
    };
    const r = summarizeRead(read, ['active_energy'], ['steps', 'active_energy', 'exercise', 'weight', 'sleep'], window7);
    expect(r).toEqual({
      steps: { status: 'ok', count: 1, latest: today },
      active_energy: { status: 'failed', count: 0, latest: null },
      exercise: { status: 'ok', count: 1, latest: '2026-11-03' },
      weight: { status: 'ok', count: 0, latest: null },
      body_fat: { status: 'not_allowed', count: 0, latest: null },
      sleep: { status: 'ok', count: 1, latest: today },
    });
    expect(summarizeRead({}, [], ['steps'], window7).weight).toEqual({ status: 'not_allowed', count: 0, latest: null });
    expect(JSON.stringify(r)).not.toMatch(/1698|95\.5/); // no health values in diagnostics
  });
});

describe('#46: body fat and automatic backfill', () => {
  const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();

  it('body fat: the latest reading of each local day, as %, with its source; out-of-range values are dropped', () => {
    const { observations, metrics } = mapHealthConnect(
      {
        bodyFat: [
          { id: 'a', time: local(5, 7, 48), percent: 32.84, origin: 'com.fitbit.FitbitMobile' },
          { id: 'b', time: local(5, 6, 0), percent: 33.1, origin: 'com.fitbit.FitbitMobile' },
          { id: 'c', time: local(4, 7, 0), percent: 0, origin: 'com.fitbit.FitbitMobile' },
          { id: 'd', time: local(3, 7, 0), percent: 140, origin: 'com.fitbit.FitbitMobile' },
        ],
      },
      syncDates('2026-11-05', false),
      local(5, 10, 54),
    );
    expect(metrics).toEqual(['body_fat']);
    expect(observations.map((o) => [o.id, o.date, o.metric, o.value, o.unit, o.source.app])).toEqual([
      ['hc:body_fat:2026-11-05', '2026-11-05', 'body_fat', 32.8, '%', 'fitbit'],
    ]);
  });

  it('a normal sync reads 7 days; the first sync 30', () => {
    expect(syncDates('2026-11-05', false, '2026-11-04')).toHaveLength(7);
    expect(syncDates('2026-11-05', false, '2026-11-05')).toHaveLength(7);
    expect(syncDates('2026-11-05', false, null)).toHaveLength(7);
    expect(syncDates('2026-11-05', true, '2026-10-01')).toHaveLength(30);
  });

  it('after a gap longer than a week, it reads from the day of the last full sync (inclusive)', () => {
    const d = syncDates('2026-11-05', false, '2026-10-24'); // 12 days ago
    expect(d[0]).toBe('2026-10-24');
    expect(d[d.length - 1]).toBe('2026-11-05');
    expect(d).toHaveLength(13);
  });

  it('a very long gap is capped at 90 days, across a month boundary and DST', () => {
    const d = syncDates('2026-11-05', false, '2026-03-01');
    expect(d).toHaveLength(90);
    expect(d[89]).toBe('2026-11-05');
    expect(syncDates('2026-04-06', false, '2026-03-30')).toHaveLength(8); // spans the April DST change
  });
});
