import { KJ_PER_KCAL } from '../energy';
import { addDays, toLocalDate, type LocalDate } from '../plan/dates';
import type { MetricId } from './metrics';
import type { Observation, Provenance } from './types';

/**
 * Android Health Connect → canonical observations (#36, contract 12). Pure: the platform adapter
 * (src/platform/healthConnect.ts) reads raw records; this module decides what they mean.
 *
 * READ ONLY. Nothing here, or anywhere in the app, writes to Health Connect.
 */

/** Marks every observation that came from Health Connect (`source.importId`), so a sync replaces only its own. */
export const HC_IMPORT_ID = 'health-connect';

/** The data types read: exactly the six permissions requested, nothing more (body fat added in #46). */
export type HcType = 'steps' | 'active_energy' | 'exercise' | 'weight' | 'body_fat' | 'sleep';
export const hcTypes: HcType[] = ['steps', 'active_energy', 'exercise', 'weight', 'body_fat', 'sleep'];

/** Health Connect record type per data type (also the READ_* permission each needs). */
export const hcRecordType = {
  steps: 'Steps',
  active_energy: 'ActiveCaloriesBurned',
  exercise: 'ExerciseSession',
  weight: 'Weight',
  body_fat: 'BodyFat',
  sleep: 'SleepSession',
} as const satisfies Record<HcType, string>;

export const hcMetric: Record<HcType, MetricId> = {
  steps: 'steps',
  active_energy: 'active_energy',
  exercise: 'exercise_session',
  weight: 'weight',
  body_fat: 'body_fat',
  sleep: 'sleep_duration',
};

export const hcTypeLabel: Record<HcType, string> = {
  steps: 'Steps',
  active_energy: 'Active energy',
  exercise: 'Workouts',
  weight: 'Weight',
  body_fat: 'Body fat',
  sleep: 'Sleep',
};

/** Days re-read on every sync (today included), and on the first sync after connecting (decision 3). */
export const SYNC_DAYS = 7;
export const FIRST_SYNC_DAYS = 30;
/** Longest automatic backfill after a gap (#46), so a long absence doesn't mean hundreds of reads on open. */
export const MAX_BACKFILL_DAYS = 90;

/** A daily total Health Connect aggregated (it dedupes overlapping apps by the user's priority order). */
export type HcDayTotal = { date: LocalDate; value: number; origins: string[] };
export type HcSleepStage = { start: string; end: string; stage: number };
/** An interval record: an exercise session or a sleep session. Times are ISO instants. */
export type HcSession = { id: string; start: string; end: string; origin: string; exerciseType?: number; title?: string; stages?: HcSleepStage[] };
export type HcDistance = { id: string; start: string; end: string; origin: string; metres: number };
export type HcWeight = { id: string; time: string; kg: number; origin: string };
/** A body fat reading: percent of body weight, 0–100 (#46). */
export type HcBodyFat = { id: string; time: string; percent: number; origin: string };

/** What one sync read. A type that is missing wasn't read (not allowed, or reading it failed). */
export type HcRead = {
  steps?: HcDayTotal[];
  /** Active energy per day, in kcal, as Health Connect aggregates it. */
  activeKcal?: HcDayTotal[];
  exercise?: HcSession[];
  distances?: HcDistance[];
  weight?: HcWeight[];
  bodyFat?: HcBodyFat[];
  sleep?: HcSession[];
};

/**
 * The local days a sync covers, oldest first, ending today: 30 on the first sync; otherwise the last 7 days, or
 * from the day of the last fully successful sync if that's earlier (#46: a gap closes itself), at most 90 days.
 */
export function syncDates(today: LocalDate, firstSync: boolean, lastFullSync?: LocalDate | null): LocalDate[] {
  let n = firstSync ? FIRST_SYNC_DAYS : SYNC_DAYS;
  if (!firstSync && lastFullSync && lastFullSync < today) {
    const sinceDays = Math.round((Date.UTC(...ymd(today)) - Date.UTC(...ymd(lastFullSync))) / 86400000) + 1;
    n = Math.min(MAX_BACKFILL_DAYS, Math.max(SYNC_DAYS, sinceDays));
  }
  return Array.from({ length: n }, (_, i) => addDays(today, i - n + 1));
}
const ymd = (d: LocalDate): [number, number, number] => {
  const [y, m, day] = d.split('-').map(Number);
  return [y, m - 1, day];
};

/** Common Health Connect data origins (package names) → the app slug stored in provenance. */
const knownApps: Record<string, string> = {
  'com.sec.android.app.shealth': 'samsung-health',
  'com.google.android.apps.fitness': 'google-fit',
  'com.fitbit.FitbitMobile': 'fitbit',
  'com.withings.wiscale2': 'withings',
  'com.garmin.android.apps.connectmobile': 'garmin-connect',
  'com.ouraring.oura': 'oura',
  'com.strava': 'strava',
  'com.huawei.health': 'huawei-health',
  'com.xiaomi.wearable': 'mi-fitness',
  'com.mi.health': 'mi-fitness',
  'com.polar.polarflow': 'polar-flow',
  'com.google.android.apps.wear.companion': 'pixel-watch',
};

/**
 * Health Connect's own on-device recording (the phone's step counter and similar, #44). Its data origin is the
 * Health Connect module itself, e.g. "com.android.healthconnect.phone.<id>" or the Health Connect app.
 */
const isPhoneOrigin = (origin: string) => origin.startsWith('com.android.healthconnect') || origin === 'com.google.android.apps.healthdata' || origin === 'android';

/** Provenance app for a data origin: a known slug, "phone" for on-device recording, else the package as reported. */
export const appForOrigin = (origin: string | undefined): string | null => {
  if (!origin) return null;
  if (knownApps[origin]) return knownApps[origin];
  return isPhoneOrigin(origin) ? 'phone' : origin;
};

/**
 * All the sources of a daily total (#44: steps can come from Fitbit and the phone at once), as one provenance
 * value: slugs joined with ",", named apps first, then the phone, then unknown packages. Null when none.
 */
export function appsForOrigins(origins: string[]): string | null {
  const rank = (a: string) => (a === 'phone' ? 1 : a.includes('.') ? 2 : 0);
  const apps = [...new Set(origins.map(appForOrigin).filter((a): a is string => !!a))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return apps.length ? apps.join(',') : null;
}

/** Health Connect exercise types (ExerciseType constants) → readable labels. Unknown types read "Workout". */
const exerciseLabels: Record<number, string> = {
  0: 'Workout',
  2: 'Badminton',
  5: 'Basketball',
  8: 'Cycling',
  9: 'Stationary bike',
  10: 'Boot camp',
  11: 'Boxing',
  13: 'Calisthenics',
  16: 'Dancing',
  25: 'Elliptical',
  26: 'Exercise class',
  32: 'Golf',
  36: 'HIIT',
  37: 'Hiking',
  44: 'Martial arts',
  48: 'Pilates',
  53: 'Rowing',
  54: 'Rowing machine',
  56: 'Running',
  57: 'Treadmill run',
  61: 'Skiing',
  64: 'Soccer',
  66: 'Squash',
  68: 'Stair climbing',
  69: 'Stair climber',
  70: 'Strength training',
  71: 'Stretching',
  73: 'Open-water swim',
  74: 'Pool swim',
  75: 'Table tennis',
  76: 'Tennis',
  79: 'Walk',
  81: 'Weightlifting',
  83: 'Yoga',
};
export const exerciseLabel = (type: number | undefined): string => (type !== undefined && exerciseLabels[type]) || 'Workout';

/** Sleep stages that count as asleep: SLEEPING, LIGHT, DEEP, REM. Awake, out of bed and unknown don't. */
const ASLEEP_STAGES = new Set([2, 4, 5, 6]);

const ms = (iso: string) => new Date(iso).getTime();
const minutes = (msSpan: number) => msSpan / 60000;
type Span = [number, number];

/** Merge overlapping spans, so time two apps both recorded counts once. */
function union(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([...s]);
  }
  return out;
}
const total = (spans: Span[]) => spans.reduce((n, [a, b]) => n + (b - a), 0);
const overlap = (a: Span, b: Span) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

function source(app: string | null, capturedAt: string | null): Provenance {
  return { type: 'integration', app, capturedAt, confidence: null, importId: HC_IMPORT_ID, assetId: null, evidence: null, edited: false };
}

function observation(id: string, date: LocalDate, metric: MetricId, value: number, unit: string, label: string | null, src: Provenance, recordedAt: string): Observation {
  return { id, date, metric, value, unit, kind: 'observed', label, note: null, source: src, recordedAt };
}

/**
 * Exercise sessions to keep: when sessions from different apps overlap by more than half of the shorter one, they
 * are the same workout recorded twice, and the longer one is kept. A single app's own sessions are all kept.
 */
export function dedupeSessions(sessions: HcSession[]): HcSession[] {
  const span = (s: HcSession): Span => [ms(s.start), ms(s.end)];
  const kept: HcSession[] = [];
  for (const s of [...sessions].sort((a, b) => total([span(b)]) - total([span(a)]) || a.id.localeCompare(b.id))) {
    const dup = kept.some((k) => (k.exerciseType === undefined || s.exerciseType === undefined || k.exerciseType === s.exerciseType) && ((span(k)[0] === span(s)[0] && span(k)[1] === span(s)[1]) || (k.origin !== s.origin && overlap(span(k), span(s)) > 0.5 * Math.min(total([span(k)]), total([span(s)])))));
    if (!dup) kept.push(s);
  }
  return kept.sort((a, b) => ms(a.start) - ms(b.start));
}

/** Only same-origin distance intervals wholly inside a session are attributable. Never prorate. */
export function sessionDistance(session: HcSession, distances: HcDistance[] | undefined): { distanceMeters?: number; distancePartial?: boolean } {
  if (!session.origin) return {}; // Missing provenance cannot establish a matching source.
  const start=ms(session.start), end=ms(session.end);
  const candidates=(distances??[]).filter(d=>d.origin===session.origin && Number.isFinite(d.metres) && d.metres>=0 && ms(d.start)>=start && ms(d.end)<=end && ms(d.end)>ms(d.start)).sort((a,b)=>(ms(b.end)-ms(b.start))-(ms(a.end)-ms(a.start)) || a.id.localeCompare(b.id));
  const kept:HcDistance[]=[];
  for(const d of candidates) if(!kept.some(k=>overlap([ms(d.start),ms(d.end)],[ms(k.start),ms(k.end)])>0))kept.push(d);
  if(!kept.length)return {};
  const covered=total(union(kept.map(d=>[ms(d.start),ms(d.end)])));
  return {distanceMeters:kept.reduce((n,d)=>n+d.metres,0),distancePartial:covered<end-start || kept.length<candidates.length};
}

/** Minutes asleep in one session: its asleep stages when it has stages, else its whole length. */
function asleepSpans(s: HcSession): Span[] {
  if (s.stages?.length) return s.stages.filter((st) => ASLEEP_STAGES.has(st.stage)).map((st) => [ms(st.start), ms(st.end)] as Span);
  return [[ms(s.start), ms(s.end)]];
}

export type HcMapped = {
  /** The observations for the synced days. */
  observations: Observation[];
  /** Metrics that were read: only their Health Connect records are replaced on these days. */
  metrics: MetricId[];
};

/**
 * Map one sync's reads to observations for `dates`. Deterministic ids make a re-sync replace, never duplicate:
 * `hc:<metric>:<date>` for daily values, `hc:exercise:<record id>` for workouts.
 */
export function mapHealthConnect(read: HcRead, dates: LocalDate[], recordedAt: string, localDateOf: (iso: string) => LocalDate = (iso) => toLocalDate(new Date(iso))): HcMapped {
  const inWindow = new Set(dates);
  const out: Observation[] = [];
  const metrics: MetricId[] = [];

  if (read.steps) {
    metrics.push('steps');
    for (const d of read.steps) {
      if (!inWindow.has(d.date) || d.value <= 0) continue;
      out.push(observation(`hc:steps:${d.date}`, d.date, 'steps', Math.round(d.value), 'count', null, source(appsForOrigins(d.origins), null), recordedAt));
    }
  }
  if (read.activeKcal) {
    metrics.push('active_energy');
    for (const d of read.activeKcal) {
      if (!inWindow.has(d.date) || d.value <= 0) continue;
      // Stored canonically in kJ (contract 06); shown in the user's energy display (contract 11).
      out.push(observation(`hc:active_energy:${d.date}`, d.date, 'active_energy', d.value * KJ_PER_KCAL, 'kJ', null, source(appsForOrigins(d.origins), null), recordedAt));
    }
  }
  if (read.exercise) {
    metrics.push('exercise_session');
    for (const s of [...new Map(read.exercise.map(s=>[s.id,s])).values()]) {
      const date = localDateOf(s.start);
      const min = Math.round(minutes(ms(s.end) - ms(s.start)));
      if (!inWindow.has(date) || min < 1) continue;
      const label = s.title?.trim() || exerciseLabel(s.exerciseType);
      out.push({ ...observation(`hc:exercise:${s.id}`, date, 'exercise_session', min, 'min', label, source(appForOrigin(s.origin), s.start), recordedAt), activity:{start:s.start,end:s.end,exerciseType:s.exerciseType,...sessionDistance(s,read.distances)} });
    }
  }
  if (read.weight) {
    metrics.push('weight');
    // One per day: the latest weigh-in of the day.
    const latest = new Map<LocalDate, HcWeight>();
    for (const w of read.weight) {
      const date = localDateOf(w.time);
      const cur = latest.get(date);
      if (w.kg > 0 && (!cur || ms(w.time) > ms(cur.time))) latest.set(date, w);
    }
    for (const [date, w] of latest) {
      if (!inWindow.has(date)) continue;
      out.push(observation(`hc:weight:${date}`, date, 'weight', Math.round(w.kg * 100) / 100, 'kg', null, source(appForOrigin(w.origin), w.time), recordedAt));
    }
  }
  if (read.bodyFat) {
    metrics.push('body_fat');
    // One per day, like weight: the latest reading of the day (#46).
    const latest = new Map<LocalDate, HcBodyFat>();
    for (const b of read.bodyFat) {
      const date = localDateOf(b.time);
      const cur = latest.get(date);
      if (b.percent > 0 && b.percent <= 100 && (!cur || ms(b.time) > ms(cur.time))) latest.set(date, b);
    }
    for (const [date, b] of latest) {
      if (!inWindow.has(date)) continue;
      out.push(observation(`hc:body_fat:${date}`, date, 'body_fat', Math.round(b.percent * 10) / 10, '%', null, source(appForOrigin(b.origin), b.time), recordedAt));
    }
  }
  if (read.sleep) {
    metrics.push('sleep_duration');
    // A night belongs to the day you wake up. Sessions from different apps are merged, not added.
    const byDay = new Map<LocalDate, HcSession[]>();
    for (const s of read.sleep) {
      const date = localDateOf(s.end);
      byDay.set(date, [...(byDay.get(date) ?? []), s]);
    }
    for (const [date, sessions] of byDay) {
      if (!inWindow.has(date)) continue;
      const min = Math.round(minutes(total(union(sessions.flatMap(asleepSpans)))));
      if (min < 1) continue;
      const main = [...sessions].sort((a, b) => ms(b.end) - ms(b.start) - (ms(a.end) - ms(a.start)))[0];
      out.push(observation(`hc:sleep:${date}`, date, 'sleep_duration', min, 'min', null, source(appForOrigin(main.origin), main.end), recordedAt));
    }
  }

  return { observations: out.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)), metrics };
}

/**
 * What one sync found per type (#44), so the app can tell "none in Health Connect" from "not allowed" and
 * "couldn't read". Counts and dates only: no health values.
 */
export type HcTypeResult = {
  status: 'ok' | 'failed' | 'not_allowed';
  /** Records (or days with a daily total) Health Connect returned for the synced days. */
  count: number;
  /** Local date of the latest one, or null when there were none. */
  latest: LocalDate | null;
};

export function summarizeRead(
  read: HcRead,
  failed: HcType[],
  granted: HcType[],
  dates: LocalDate[],
  localDateOf: (iso: string) => LocalDate = (iso) => toLocalDate(new Date(iso)),
): Record<HcType, HcTypeResult> {
  const inWindow = new Set(dates);
  const summary = (days: LocalDate[]) => {
    const ds = days.filter((d) => inWindow.has(d)).sort();
    return { count: ds.length, latest: ds[ds.length - 1] ?? null };
  };
  const found: Record<HcType, LocalDate[] | undefined> = {
    steps: read.steps?.filter((d) => d.value > 0).map((d) => d.date),
    active_energy: read.activeKcal?.filter((d) => d.value > 0).map((d) => d.date),
    exercise: read.exercise?.map((s) => localDateOf(s.start)),
    weight: read.weight?.filter((w) => w.kg > 0).map((w) => localDateOf(w.time)),
    body_fat: read.bodyFat?.filter((b) => b.percent > 0).map((b) => localDateOf(b.time)),
    sleep: read.sleep?.map((s) => localDateOf(s.end)),
  };
  return Object.fromEntries(
    hcTypes.map((t): [HcType, HcTypeResult] => {
      if (!granted.includes(t)) return [t, { status: 'not_allowed', count: 0, latest: null }];
      if (failed.includes(t) || !found[t]) return [t, { status: 'failed', count: 0, latest: null }];
      return [t, { status: 'ok', ...summary(found[t]!) }];
    }),
  ) as Record<HcType, HcTypeResult>;
}
