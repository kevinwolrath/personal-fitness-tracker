import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { toLocalDate, type LocalDate } from '../../plan/dates';
import type { Activity, Measurement, Plan } from '../../plan/schema';
import * as completion from '../../prescription/completion';
import * as exercises from '../../prescription/exercises';
import { nextAction } from '../../prescription/nextAction';
import { prescribeDay, type PrescriptionItem } from '../../prescription/prescribe';
import { measurementMetric } from '../../observations/planMetrics';
import { manualSource, type Observation } from '../../observations/types';
import { localIsoTimestamp } from '../../format';
import { newId, type ActivityLog, type DayRecords, type TrackingStore } from '../../storage/types';

const emptyDay: DayRecords = { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] };

export type Clock = { today: LocalDate; nowMinutes: number };

/** The local date and minute of `d` (pure; exported for tests). */
export function clockAt(d: Date): Clock {
  return { today: toLocalDate(d), nowMinutes: d.getHours() * 60 + d.getMinutes() };
}

/**
 * Local date and minute as one value, so a day rollover never pairs the new date with yesterday's time (#51).
 * Updates at each minute boundary (including midnight) and when the app returns to the foreground.
 */
export function useClock(): Clock {
  const [clock, setClock] = useState(() => clockAt(new Date()));
  useEffect(() => {
    const refresh = () =>
      setClock((prev) => {
        const next = clockAt(new Date());
        return next.today === prev.today && next.nowMinutes === prev.nowMinutes ? prev : next;
      });
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const now = new Date();
      timer = setTimeout(() => {
        refresh();
        arm();
      }, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 50);
    };
    arm();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && refresh());
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, []);
  return clock;
}

/**
 * One day's prescription + tracking records, with optimistic actions (contract 02 "Feedback").
 * Writes go to the store immediately; on failure the day is reloaded from storage.
 */
/** `dataVersion` changes when records change outside this hook (a Health Connect sync): the day reloads quietly. */
export function useDay(store: TrackingStore, plan: Plan, date: LocalDate, dataVersion = 0) {
  const [records, setRecords] = useState<DayRecords | null>(null);
  const [previous, setPrevious] = useState<Record<string, Observation | null>>({});
  const current = useRef<DayRecords>(emptyDay);
  // The date whose data may be shown. A slow load for a date the user already left is discarded.
  const shownDate = useRef(date);
  shownDate.current = date;

  const load = useCallback(async () => {
    const [day, ...latest] = await Promise.all([
      store.getDay(plan.id, date),
      ...plan.measurements.map((m) => store.latestObservation(m.id, date)),
    ]);
    if (shownDate.current !== date) return;
    current.current = day;
    setRecords(day);
    setPrevious(Object.fromEntries(plan.measurements.map((m, i) => [m.id, latest[i]])));
  }, [store, plan, date]);

  useEffect(() => {
    setRecords(null);
    load();
  }, [load]);

  // Records changed elsewhere (a sync): reload in place, without blanking the day.
  const firstVersion = useRef(dataVersion);
  useEffect(() => {
    if (dataVersion !== firstVersion.current) load();
  }, [dataVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = useCallback(
    (next: DayRecords, persist: () => Promise<void>) => {
      current.current = next;
      setRecords(next);
      persist().catch(() => load());
    },
    [load],
  );

  // Prescription for this date (contract 08), recomputed from the latest records.
  const prescription = useMemo(() => prescribeDay(plan, date, records ?? emptyDay), [plan, date, records]);
  const prescriptionRef = useRef(prescription);
  prescriptionRef.current = prescription;

  /** Persist a completion change: state + append-only event + the day's prescription snapshot. */
  const record = useCallback(
    (c: completion.CompletionChange) => {
      const activities = { ...current.current.activities };
      if (c.log) activities[c.activityId] = c.log;
      else delete activities[c.activityId];
      const next = { ...current.current, activities };
      const snapshot = completion.snapshotOf(prescribeDay(plan, date, next), plan.id, plan.revision, c.event.at);
      commit(next, () => store.logCompletion(plan.id, date, c.activityId, c.log, c.event, snapshot));
    },
    [commit, store, plan, date],
  );

  const ctx = useCallback(
    (item: PrescriptionItem, activityId: string) => ({
      planId: plan.id,
      date,
      now: localIsoTimestamp(),
      current: current.current.activities[activityId],
      item,
    }),
    [plan.id, date],
  );

  /** Primary tap on an item (or on one alternative of a requirement). */
  const advance = useCallback(
    (item: PrescriptionItem, activity: Activity) => record(completion.advance(ctx(item, activity.id), activity)),
    [record, ctx],
  );
  const setDone = useCallback(
    (item: PrescriptionItem, activity: Activity, done: boolean, variant: 'full' | 'short' = 'full') =>
      record(completion.setDone(ctx(item, activity.id), activity, done, variant)),
    [record, ctx],
  );
  /** Tick/untick one exercise of a session (#28). Returns the change, so the UI can see a completion. */
  const tickExercise = useCallback(
    (item: PrescriptionItem, activity: Activity, key: string, ticked: boolean) => {
      const c = exercises.tickExercise(ctx(item, activity.id), activity, item.session!, key, ticked);
      record(c);
      return c;
    },
    [record, ctx],
  );
  /** Choose the full or short version of a session (#28). */
  const chooseVariant = useCallback(
    (item: PrescriptionItem, activity: Activity, variant: exercises.Variant) => {
      const c = exercises.chooseVariant(ctx(item, activity.id), activity, item.session!, variant);
      if (c) record(c);
    },
    [record, ctx],
  );
  const setSkipped = useCallback(
    (item: PrescriptionItem, skipped: boolean) => record(completion.setSkipped(ctx(item, item.key), skipped)),
    [record, ctx],
  );

  const setDayType = useCallback(
    (dayTypeId: string | null) =>
      commit({ ...current.current, dayTypeOverride: dayTypeId }, () => store.setDayOverride(plan.id, date, dayTypeId)),
    [commit, store, plan.id, date],
  );

  const addMeasurement = useCallback(
    /** `value` is in plan units, as typed; it is stored canonically as a manual observation. */
    (m: Measurement, value: number) => {
      const map = measurementMetric(plan, m);
      const entry: Observation = {
        id: newId(),
        date,
        metric: map.metric,
        value: map.toStored(value),
        unit: map.storedUnit,
        kind: 'observed',
        label: null,
        note: null,
        source: manualSource(),
        recordedAt: new Date().toISOString(),
      };
      setPrevious((p) => ({ ...p, [m.id]: entry }));
      commit({ ...current.current, observations: [...current.current.observations, entry] }, () => store.addObservations([entry]));
    },
    [commit, store, plan, date],
  );

  /** Correct a stored observation's value in place (any source); provenance records the edit. */
  const correctObservation = useCallback(
    (o: Observation, value: number) => {
      if (value === o.value) return;
      const next: Observation = { ...o, value, source: { ...o.source, edited: true } };
      commit({ ...current.current, observations: current.current.observations.map((x) => (x.id === o.id ? next : x)) }, async () => {
        await store.addObservations([next]);
        await load();
      });
    },
    [commit, store, load],
  );

  const removeObservation = useCallback(
    (id: string) => {
      commit({ ...current.current, observations: current.current.observations.filter((o) => o.id !== id) }, async () => {
        await store.removeObservation(id);
        await load(); // the "latest" value may now come from an earlier day
      });
    },
    [commit, store, load],
  );

  return {
    loading: records === null,
    day: prescription.day,
    prescription,
    progress: prescription.progress,
    /** What to do now, from the prescription and the local time (only meaningful for today). */
    nextAt: (nowMinutes: number) => nextAction(prescriptionRef.current, nowMinutes),
    records: records ?? emptyDay,
    reload: load,
    /** Latest observed value on or before this day, per plan measurement id. */
    latestMeasurement: previous,
    actions: { advance, setDone, setSkipped, tickExercise, chooseVariant, setDayType, addMeasurement, removeObservation, correctObservation },
  };
}
