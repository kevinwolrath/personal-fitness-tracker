import { useEffect, useState } from 'react';
import { exerciseState, loadExerciseHistory, type ExerciseState } from '../../exercises/state';
import type { LocalDate } from '../../plan/dates';
import type { Plan } from '../../plan/schema';
import type { Prescription } from '../../prescription/prescribe';
import type { TrackingStore } from '../../storage/types';

/**
 * Muscle coverage, suggestions and today's session order (#56), for today only. Loaded when the day, plan, data or
 * today's set of sessions changes; never on each tick, so a workout's order stays put while it's being done.
 * Null while loading or off today (callers then use the plan order). A failed load also means plan order.
 */
export function useExerciseState(store: TrackingStore, plan: Plan, today: LocalDate, prescription: Prescription, enabled: boolean, dataVersion = 0): ExerciseState | null {
  const [state, setState] = useState<ExerciseState | null>(null);
  const sessions = prescription.items.filter((i) => i.session).map((i) => ({ activityId: i.key, session: i.session! }));
  const sessionKey = sessions.map((s) => s.activityId).join('|');
  useEffect(() => {
    if (!enabled) {
      setState(null);
      return;
    }
    let live = true;
    loadExerciseHistory(store, plan, today)
      .then((history) => live && setState(exerciseState(plan, history, { now: new Date().toISOString(), today, todaySessions: sessions })))
      .catch(() => live && setState(null));
    return () => {
      live = false;
    };
  }, [store, plan, today, enabled, dataVersion, sessionKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}
