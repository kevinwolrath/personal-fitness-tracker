import { COVERAGE, effectiveSets, hasEnoughHistory, muscleCoverage, sessionExerciseOrder, suggestExercises, windowStart, type ExerciseEntry, type MuscleReport } from '../coverage';
import { eligibleExercises, exerciseInventory } from '../inventory';

/** #56: muscle-group priority and recovery, from approved rules. Times are AEDT (+11:00). */

const MON = '2026-11-09'; // Monday
const t = (date: string, hhmm: string) => `${date}T${hhmm}:00+11:00`;
let n = 0;
const entry = (movement: string, date: string, hhmm: string, over: Partial<ExerciseEntry> = {}): ExerciseEntry => ({
  id: `e${n++}`, movement, date, at: t(date, hhmm), sets: 3, reps: 10, source: 'free', ...over,
});
const day = (offset: number) => {
  const d = new Date(`${MON}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
/** Any old entry, so history is long enough for red (first-use rule). */
const longAgo = entry('standing_calf_raise', day(-30), '07:00', { sets: 1 });

const coverage = (entries: ExerciseEntry[], opts: { now?: string; today?: string; reports?: MuscleReport[]; restDays?: ('mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun')[] } = {}) =>
  Object.fromEntries(
    muscleCoverage({ inventory: exerciseInventory, entries, now: opts.now ?? t(MON, '18:00'), today: opts.today ?? MON, reports: opts.reports, restDays: opts.restDays }).map((c) => [c.muscle, c]),
  );

describe('effective sets: completed sets, reps or hold time, and intensity', () => {
  it('three sets of ten count as three; one push-up is not a set', () => {
    expect(effectiveSets(entry('knuckle_push_up', MON, '08:00'))).toBe(3);
    expect(effectiveSets(entry('knuckle_push_up', MON, '08:00', { sets: 1, reps: 1 }))).toBeCloseTo(1 / COVERAGE.repsForFullSet);
  });

  it('holds scale by time; light sets count half; no reps or time means whole sets', () => {
    expect(effectiveSets(entry('plank', MON, '08:00', { reps: undefined, seconds: 30, sets: 2 }))).toBe(2);
    expect(effectiveSets(entry('plank', MON, '08:00', { reps: undefined, seconds: 10, sets: 2 }))).toBe(1);
    expect(effectiveSets(entry('chest_press', MON, '08:00', { intensity: 'light' }))).toBe(1.5);
  });

  it('conditioning counts by time with its own model: a 3-minute boxing round is well under one hard set', () => {
    const round = effectiveSets(entry('vr_boxing', MON, '08:00', { reps: undefined, sets: 1 }), 'conditioning');
    expect(round).toBeCloseTo(COVERAGE.conditioning.minutesPerRound * COVERAGE.conditioning.effectiveSetsPerMinute);
    expect(round).toBeLessThan(effectiveSets(entry('chest_press', MON, '08:00', { sets: 1 })));
    expect(effectiveSets(entry('battle_ropes', MON, '08:00', { reps: undefined, sets: 1, minutes: 10 }), 'conditioning')).toBeCloseTo(1.5);
    expect(effectiveSets(entry('heavy_bag', MON, '08:00', { reps: undefined, sets: 4, seconds: 90 }), 'conditioning')).toBeCloseTo(0.9); // 6 min
    expect(effectiveSets(entry('heavy_bag', MON, '08:00', { reps: undefined, sets: 1, minutes: 10, intensity: 'light' }), 'conditioning')).toBeCloseTo(0.75);
  });
});

describe('the volume window skips rest days', () => {
  it('seven training days back, rest days not counted', () => {
    expect(windowStart(MON)).toBe('2026-11-03'); // Tue
    expect(windowStart(MON, ['fri'])).toBe('2026-11-02'); // Friday skipped: one more day back
  });

  it('a rest day never ages volume out, so it never makes a muscle overdue', () => {
    const lastMonday = [longAgo, entry('chest_press', '2026-11-02', '08:00', { sets: 6 })];
    expect(coverage(lastMonday).chest.status).toBe('red'); // 8 days ago: outside a 7-day window
    expect(coverage(lastMonday, { restDays: ['fri'] }).chest.status).toBe('green'); // Friday rest: still inside
  });
});

describe('muscle status', () => {
  it('first use: nothing is red; untrained muscles are neutral until there is enough history', () => {
    const c = coverage([entry('chest_press', MON, '08:00')]);
    expect(c.calves.status).toBe('unknown');
    expect(c.hamstrings.status).toBe('unknown');
    expect(coverage([]).chest.status).toBe('unknown');
  });

  it('with enough history, an untrained muscle is red (due), and only because it has recovered', () => {
    const c = coverage([longAgo]);
    expect(c.hamstrings).toMatchObject({ status: 'red', volume: 0 });
  });

  it('primary counts 1.0 per set and secondary 0.5', () => {
    const c = coverage([longAgo, entry('chest_press', day(-3), '08:00')]);
    expect(c.chest.volume).toBe(3);
    expect(c.triceps.volume).toBe(1.5);
    expect(c.shoulders.volume).toBe(1.5);
    expect(c.lats.volume).toBe(0);
  });

  it('green at the weekly target, amber from half of it, red below', () => {
    const at = (sets: number) => coverage([longAgo, entry('leg_extension', day(-4), '08:00', { sets })]).quadriceps.status;
    expect(at(6)).toBe('green');
    expect(at(3)).toBe('amber');
    expect(at(2)).toBe('red');
  });

  it('duplicate entries count once; future entries and unknown movements are ignored', () => {
    const e = entry('chest_press', day(-3), '08:00');
    expect(coverage([longAgo, e, { ...e }]).chest.volume).toBe(3);
    expect(coverage([longAgo, entry('chest_press', MON, '20:00')]).chest.volume).toBe(0); // after now (18:00)
    expect(coverage([longAgo, entry('cable_row', day(-3), '08:00')]).upper_back.volume).toBe(0); // not in the inventory
  });
});

describe('recovery is independent of priority', () => {
  const hoursLater = (iso: string, h: number) => new Date(Date.parse(iso) + h * 3_600_000).toISOString();

  it('a hard session (3 sets) recovers in about 48 h; the muscle is "recovering" even though it is below target', () => {
    const e = entry('leg_extension', MON, '08:00');
    expect(coverage([longAgo, e]).quadriceps).toMatchObject({ status: 'recovering', volume: 3, recoveredAt: hoursLater(e.at, 48) });
    expect(coverage([longAgo, e], { now: hoursLater(e.at, 48), today: day(2) }).quadriceps.status).toBe('amber');
  });

  it('a light session (≤ 2 effective sets) ~24 h; a particularly demanding one (≥ 6) up to 72 h', () => {
    const light = entry('leg_extension', MON, '08:00', { sets: 2 });
    expect(coverage([longAgo, light]).quadriceps.recoveredAt).toBe(hoursLater(light.at, 24));
    const big = entry('leg_extension', MON, '08:00', { sets: 6 });
    expect(coverage([longAgo, big]).quadriceps.recoveredAt).toBe(hoursLater(big.at, 72));
  });

  it('intensity marked hard makes even a small session a hard one', () => {
    const e = entry('leg_extension', MON, '08:00', { sets: 1, intensity: 'hard' });
    expect(coverage([longAgo, e]).quadriceps.recoveredAt).toBe(hoursLater(e.at, 48));
  });

  it('a few stray reps need no recovery', () => {
    expect(coverage([longAgo, entry('knuckle_push_up', MON, '08:00', { sets: 1, reps: 2 })]).chest.status).not.toBe('recovering');
  });

  it('secondary work counts towards recovery too, at half weight', () => {
    expect(coverage([longAgo, entry('chest_press', MON, '08:00')]).triceps.status).toBe('recovering'); // 1.5 effective: light
  });
});

describe('user reports override automatic readiness', () => {
  const sore: MuscleReport = { id: 'r1', muscle: 'chest', kind: 'sore', at: t(day(-1), '20:00'), clearedAt: null };

  it('a sore or injured muscle is unavailable, whatever its volume or recovery', () => {
    expect(coverage([longAgo], { reports: [sore] }).chest).toMatchObject({ status: 'unavailable', report: 'sore' });
    expect(coverage([longAgo], { reports: [{ ...sore, kind: 'injured' }] }).chest.report).toBe('injured');
  });

  it('cleared reports and reports made later than now have no effect', () => {
    expect(coverage([longAgo], { reports: [{ ...sore, clearedAt: t(MON, '07:00') }] }).chest.status).toBe('red');
    expect(coverage([longAgo], { reports: [{ ...sore, at: t(MON, '19:00') }] }).chest.status).toBe('red');
  });
});

describe('suggestions: priority, recovery, equipment and limitations', () => {
  const all = eligibleExercises({ equipment: [{ type: 'home_gym' }, { type: 'kettlebell' }, { type: 'free_weights' }, { type: 'heavy_bag' }, { type: 'vr_headset' }, { type: 'battle_ropes' }] });
  const names = (s: ReturnType<typeof suggestExercises>) => s.map((x) => x.exercise.movement);

  it('exercises for the muscles most in need come first; every exercise stays available', () => {
    // Chest and quads well trained this week (and recovered); everything else untrained.
    const c = muscleCoverage({ inventory: exerciseInventory, entries: [longAgo, entry('chest_press', day(-4), '08:00', { sets: 6 }), entry('leg_extension', day(-4), '08:00', { sets: 6 })], now: t(MON, '18:00'), today: MON });
    const s = suggestExercises(all, c);
    // Two untrained primary muscles (upper back and lats) beat one; the well-trained muscles' exercises sink.
    expect(names(s)[0]).toBe('one_arm_kettlebell_row');
    expect(names(s).indexOf('standing_calf_raise')).toBeLessThan(names(s).indexOf('chest_press'));
    expect(names(s).at(-1)).toBe('leg_extension'); // quads only, at target: nothing left to gain
    expect(s).toHaveLength(all.filter((e) => e.exercise.kind === 'strength').length);
  });

  it('a recovering primary muscle holds an exercise back (listed after, still loggable); secondary recovery does not', () => {
    const c = muscleCoverage({ inventory: exerciseInventory, entries: [longAgo, entry('leg_extension', MON, '08:00')], now: t(MON, '18:00'), today: MON });
    const s = suggestExercises(all, c);
    const squat = s.find((x) => x.exercise.movement === 'kettlebell_squat')!;
    expect(squat.held).toEqual([{ muscle: 'quadriceps', status: 'recovering' }]);
    expect(names(s).slice(-2)).toEqual(['kettlebell_squat', 'leg_extension']);
  });

  it('an unavailable muscle holds back exercises that use it at all, even as a secondary', () => {
    const c = muscleCoverage({ inventory: exerciseInventory, entries: [longAgo], reports: [{ id: 'r', muscle: 'triceps', kind: 'injured', at: t(day(-1), '08:00'), clearedAt: null }], now: t(MON, '18:00'), today: MON });
    const s = suggestExercises(all, c);
    expect(s.find((x) => x.exercise.movement === 'chest_press')!.held).toEqual([{ muscle: 'triceps', status: 'unavailable' }]);
  });

  it('exercises done today go to the bottom; repeats are never blocked', () => {
    const c = muscleCoverage({ inventory: exerciseInventory, entries: [longAgo], now: t(MON, '18:00'), today: MON });
    const s = suggestExercises(all, c, { doneToday: new Set(['standing_calf_raise']) });
    expect(names(s).at(-1)).toBe('standing_calf_raise');
    expect(s.at(-1)!.doneToday).toBe(true);
  });

  it('conditioning stays out of strength suggestions unless asked for, but its muscle work counts', () => {
    const c = muscleCoverage({ inventory: exerciseInventory, entries: [longAgo, entry('vr_boxing', day(-2), '19:00', { reps: undefined, sets: 6 })], now: t(MON, '18:00'), today: MON });
    expect(names(suggestExercises(all, c))).not.toContain('vr_boxing');
    expect(names(suggestExercises(all, c, { includeConditioning: true }))).toContain('vr_boxing');
    expect(c.find((m) => m.muscle === 'shoulders')!.volume).toBe(2.7); // 6 rounds x 3 min x 0.15, not 6 sets
  });

  it('only the user’s equipment is suggested, and "caution" is carried through', () => {
    const none = eligibleExercises({ limitations: [{ movement: 'plank', status: 'caution' }] });
    const s = suggestExercises(none, muscleCoverage({ inventory: exerciseInventory, entries: [], now: t(MON, '18:00'), today: MON }));
    expect(names(s).sort()).toEqual(['knuckle_push_up', 'plank', 'standing_calf_raise', 'straight_leg_raise']);
    expect(s.find((x) => x.exercise.movement === 'plank')!.caution).toBe(true);
  });
});

describe('option C: a scheduled session keeps its exercises, ordered by priority', () => {
  const session = ['kettlebell_squat', 'chest_press', 'lat_pulldown', 'cable_row', 'hammer_curl'].map((movement) => ({ movement }));
  const cov = (entries: ExerciseEntry[]) => muscleCoverage({ inventory: exerciseInventory, entries, now: t(MON, '06:00'), today: MON });
  const moves = (order: number[]) => order.map((i) => session[i].movement);

  it('first use (not enough history): the plan order, unchanged', () => {
    const entries = [entry('chest_press', day(-2), '08:00', { sets: 6 })];
    expect(hasEnoughHistory(entries, exerciseInventory, MON)).toBe(false);
    expect(sessionExerciseOrder(session, cov(entries), exerciseInventory, false)).toEqual([0, 1, 2, 3, 4]);
  });

  it('with history: exercises for muscles in need first; nothing added or dropped; unknown movements keep their slot', () => {
    const entries = [longAgo, entry('chest_press', day(-4), '08:00', { sets: 6 })];
    expect(hasEnoughHistory(entries, exerciseInventory, MON)).toBe(true);
    const order = sessionExerciseOrder(session, cov(entries), exerciseInventory, true);
    expect([...order].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(order[3]).toBe(3); // cable_row (legacy, not in the inventory) stays in its slot
    expect(moves(order).indexOf('chest_press')).toBeGreaterThan(moves(order).indexOf('lat_pulldown')); // chest is well trained
  });

  it('an exercise whose primary muscle is still recovering moves after the others', () => {
    const entries = [longAgo, entry('lat_pulldown', MON, '05:00')];
    const order = moves(sessionExerciseOrder(session, cov(entries), exerciseInventory, true));
    expect(order.at(-1)).toBe('lat_pulldown');
  });

  it('ties keep the plan order (stable)', () => {
    const twice = [{ movement: 'plank' }, { movement: 'plank' }];
    expect(sessionExerciseOrder(twice, cov([longAgo]), exerciseInventory, true)).toEqual([0, 1]);
  });
});
