import { useEffect, useState } from 'react';
import { exerciseState, loadExerciseHistory, type ExerciseState } from '../../exercises/state';
import type { LocalDate } from '../../plan/dates';
import type { Plan } from '../../plan/schema';
import type { Prescription } from '../../prescription/prescribe';
import type { TrackingStore } from '../../storage/types';

/**
 * Muscle coverage, suggestions and today's session order (#56), for today only. Loaded when the day, plan, data or
 * today's set of sessions changes; never on each tick, so a workout's order stays put while it's being done.
 * `state` is null while loading, off today, or after a failed load (callers then use the plan order); `loading` is
 * true only while a load for today is in flight, so a failure never leaves the screen waiting.
 */
export function useExerciseState(store: TrackingStore, plan: Plan, today: LocalDate, prescription: Prescription, enabled: boolean, dataVersion = 0): { state: ExerciseState | null; loading: boolean } {
  const [state, setState] = useState<ExerciseState | null>(null);
  const [loading, setLoading] = useState(enabled);
  const sessions = prescription.items.filter((i) => i.session).map((i) => ({ activityId: i.key, session: i.session! }));
  const sessionKey = sessions.map((s) => s.activityId).join('|');
  useEffect(() => {
    if (!enabled) {
      setState(null);
      setLoading(false);
      return;
    }
    let live = true;
    // Keep showing the previous state while reloading (e.g. after a tick), so nothing blinks; first load only waits.
    setLoading((was) => was || state === null);
    loadExerciseHistory(store, plan, today)
      .then((history) => live && setState(exerciseState(plan, history, { now: new Date().toISOString(), today, todaySessions: sessions })))
      .catch(() => live && setState(null))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [store, plan, today, enabled, dataVersion, sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return { state, loading };
}
