import type { HcType, HcTypeResult } from '../healthConnect';
import { likelySourceApp, setupChanges, setupRows, setupSummary, wantedTypes } from '../healthConnectSetup';

const ok = (count: number, latest: string | null, app: string | null = null): HcTypeResult => ({ status: 'ok', count, latest, app });
const ALL: HcType[] = ['steps', 'active_energy', 'exercise', 'weight', 'body_fat', 'sleep'];

// Kevin's phone on 9 Nov (#116): Fitbit shares sleep and steps, but isn't allowed to write weight.
const nov9 = {
  steps: ok(7, '2026-11-09', 'fitbit,phone'),
  active_energy: ok(7, '2026-11-09', 'phone'),
  exercise: ok(2, '2026-11-09', 'fitbit'),
  weight: ok(0, null),
  body_fat: { status: 'not_allowed' as const, count: 0, latest: null },
  sleep: ok(7, '2026-11-09', 'fitbit'),
};
const granted: HcType[] = ['steps', 'active_energy', 'exercise', 'weight', 'sleep'];

describe('Health Connect setup (#116)', () => {
  it('what is wanted: a stored choice; else what is allowed; before connecting, everything', () => {
    expect(wantedTypes(['weight', 'steps'], granted)).toEqual(['steps', 'weight']);
    expect(wantedTypes(null, granted)).toEqual(granted); // connected before #116: body fat starts unticked
    expect(wantedTypes(null, [])).toEqual(ALL);
  });

  it('each ticked type is working, has no data, needs access, failed or is waiting for its first check', () => {
    const rows = setupRows([...granted, 'body_fat'], granted, nov9);
    const by = Object.fromEntries(rows.map((r) => [r.type, r]));
    expect(by.weight).toMatchObject({ status: 'no_data' });
    expect(by.body_fat).toMatchObject({ status: 'needs_access' });
    expect(by.steps).toEqual({ type: 'steps', status: 'working', latest: '2026-11-09', app: 'fitbit,phone' });
    expect(setupRows(granted, granted, { ...nov9, sleep: { status: 'failed', count: 0, latest: null } }).find((r) => r.type === 'sleep')!.status).toBe('failed');
    // Allowed since the last sync: not "not allowed", not "no data" yet.
    expect(setupRows(['body_fat'], ['body_fat'], nov9).find((r) => r.type === 'body_fat')!.status).toBe('checking');
    expect(setupRows(granted, granted, undefined).find((r) => r.type === 'steps')!.status).toBe('checking');
  });

  it('unticked types are off, even when allowed, and never count as a problem', () => {
    const rows = setupRows(['steps', 'weight'], granted, nov9);
    expect(rows.find((r) => r.type === 'sleep')!.status).toBe('off');
    expect(setupSummary(rows)).toEqual({ wanted: 2, working: 1, problems: ['weight'] });
  });

  it('a check reports what it changed: fixed, still a problem, or newly broken', () => {
    const before = setupRows(granted, granted, nov9);
    const fixed = setupRows(granted, granted, { ...nov9, weight: ok(1, '2026-11-09', 'fitbit') });
    expect(setupChanges(before, fixed)).toEqual([{ type: 'weight', outcome: 'fixed' }]);
    expect(setupChanges(before, before)).toEqual([{ type: 'weight', outcome: 'still' }]);
    const sleepRevoked = setupRows(granted, granted.filter((t) => t !== 'sleep'), nov9);
    expect(setupChanges(before, sleepRevoked)).toEqual([
      { type: 'weight', outcome: 'still' },
      { type: 'sleep', outcome: 'broke' },
    ]);
    // Ticked or unticked in between: not reported as a change.
    expect(setupChanges(setupRows(['steps'], granted, nov9), setupRows(['steps', 'weight'], granted, nov9))).toEqual([]);
  });

  it('the app to fix: where the type last came from, else the named app sharing the most other types', () => {
    expect(likelySourceApp('weight', nov9)).toBe('fitbit'); // Fitbit sends steps, workouts and sleep
    expect(likelySourceApp('weight', nov9, { weight: 'withings' })).toBe('withings');
    expect(likelySourceApp('weight', { steps: ok(1, '2026-11-09', 'phone'), exercise: ok(1, '2026-11-09', 'com.example.app') })).toBeNull();
  });
});
