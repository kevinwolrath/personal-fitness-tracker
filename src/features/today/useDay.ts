import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { toLocalDate, type LocalDate } from '../../plan/dates';
import { dayProgress, resolveDay } from '../../plan/resolveDay';
import type { Activity, Measurement, Plan } from '../../plan/schema';
import { measurementMetric } from '../../observations/planMetrics';
import { manualSource, type Observation } from '../../observations/types';
import { localIsoTimestamp } from '../../format';
import { newId, type ActivityLog, type DayRecords, type TrackingStore } from '../../storage/types';

const emptyDay: DayRecords = { activities: {}, dayTypeOverride: null, observations: [], quickLogs: [] };

/** Today's local date, refreshed when the app returns to the foreground. */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => toLocalDate(new Date()));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => s === 'active' && setToday(toLocalDate(new Date())));
    return () => sub.remove();
  }, []);
  return today;
}

/**
 * One day's resolved plan + tracking records, with optimistic actions (contract 02 "Feedback").
 * Writes go to the store immediately; on failure the day is reloaded from storage.
 */
export function useDay(store: TrackingStore, plan: Plan, date: LocalDate) {
  const [records, setRecords] = useState<DayRecords | null>(null);
  const [previous, setPrevious] = useState<Record<string, Observation | null>>({});
  const current = useRef<DayRecords>(emptyDay);

  const load = useCallback(async () => {
    const [day, ...latest] = await Promise.all([
      store.getDay(plan.id, date),
      ...plan.measurements.map((m) => store.latestObservation(m.id, date)),
    ]);
    current.current = day;
    setRecords(day);
    setPrevious(Object.fromEntries(plan.measurements.map((m, i) => [m.id, latest[i]])));
  }, [store, plan, date]);

  useEffect(() => {
    setRecords(null);
    load();
  }, [load]);

  const commit = useCallback(
    (next: DayRecords, persist: () => Promise<void>) => {
      current.current = next;
      setRecords(next);
      persist().catch(() => load());
    },
    [load],
  );

  const writeActivity = useCallback(
    (a: Activity, log: Omit<ActivityLog, 'activityId' | 'labelSnapshot' | 'updatedAt'> | null) => {
      const full: ActivityLog | null = log && { ...log, activityId: a.id, labelSnapshot: a.label, updatedAt: new Date().toISOString() };
      const activities = { ...current.current.activities };
      if (full) activities[a.id] = full;
      else delete activities[a.id];
      commit({ ...current.current, activities }, () => store.setActivity(plan.id, date, a.id, full));
    },
    [commit, store, plan.id, date],
  );

  /** Primary tap: check ↔ uncheck; count advances, completes at target, then resets. */
  const advance = useCallback(
    (a: Activity) => {
      const log = current.current.activities[a.id];
      if (a.tracking.type === 'check' || log?.status === 'skipped') {
        writeActivity(a, log?.status === 'done' ? null : { status: 'done', count: 0 });
        return;
      }
      const target = a.tracking.target;
      const count = (log?.count ?? 0) + 1;
      if (count > target) writeActivity(a, null);
      else writeActivity(a, { status: count === target ? 'done' : 'pending', count });
    },
    [writeActivity],
  );

  const setDone = useCallback(
    (a: Activity, done: boolean) =>
      writeActivity(a, done ? { status: 'done', count: a.tracking.type === 'count' ? a.tracking.target : 0 } : null),
    [writeActivity],
  );

  const setSkipped = useCallback(
    (a: Activity, skipped: boolean) => writeActivity(a, skipped ? { status: 'skipped', count: 0 } : null),
    [writeActivity],
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

  const removeMeasurement = useCallback(
    (id: string) => {
      commit({ ...current.current, observations: current.current.observations.filter((o) => o.id !== id) }, async () => {
        await store.removeObservation(id);
        await load(); // the "latest" value may now come from an earlier day
      });
    },
    [commit, store, load],
  );

  const addQuickLog = useCallback(
    (quickLogId: string): string => {
      const entry = { id: newId(), planId: plan.id, quickLogId, date, at: localIsoTimestamp() };
      commit({ ...current.current, quickLogs: [...current.current.quickLogs, entry] }, () => store.addQuickLog(entry));
      return entry.id;
    },
    [commit, store, plan.id, date],
  );

  const removeQuickLog = useCallback(
    (id: string) =>
      commit({ ...current.current, quickLogs: current.current.quickLogs.filter((q) => q.id !== id) }, () => store.removeQuickLog(id)),
    [commit, store],
  );

  const day = useMemo(() => resolveDay(plan, date, records?.dayTypeOverride), [plan, date, records?.dayTypeOverride]);
  const progress = useMemo(() => dayProgress(day, records?.activities ?? {}), [day, records]);

  return {
    loading: records === null,
    day,
    progress,
    records: records ?? emptyDay,
    reload: load,
    /** Latest observed value on or before this day, per plan measurement id. */
    latestMeasurement: previous,
    actions: { advance, setDone, setSkipped, setDayType, addMeasurement, removeMeasurement, addQuickLog, removeQuickLog },
  };
}
