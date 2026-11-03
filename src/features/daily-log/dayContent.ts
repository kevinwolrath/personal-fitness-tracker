import { metrics } from '../../observations/metrics';
import type { Observation } from '../../observations/types';
import type { ResolvedDay } from '../../plan/resolveDay';
import type { ActivityLog, DayRecords } from '../../storage/types';

const imported = (o: Observation) => (o.source.type === 'integration' ? 1 : 0);
const catalogOrder = new Map<string, number>(metrics.map((m, i) => [m.id, i]));

/**
 * Observations recorded on this date that the measurement panel doesn't already show:
 * imported steps, sleep, readiness, workouts, other metrics, and calculated values.
 * Ordered by catalog, then user-entered before imported (Health Connect, #36), then time. Pure.
 */
export function recordedObservations(day: ResolvedDay, records: DayRecords): Observation[] {
  const inPanel = new Set(day.measurementsDue.map((m) => m.id));
  return records.observations
    .filter((o) => !(inPanel.has(o.metric) && o.kind === 'observed'))
    .sort(
      (a, b) =>
        (catalogOrder.get(a.metric) ?? 999) - (catalogOrder.get(b.metric) ?? 999) ||
        imported(a) - imported(b) ||
        a.recordedAt.localeCompare(b.recordedAt) ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Activity records for this date whose activity the current plan no longer schedules that day
 * (plan revised, or day type changed after logging). History stays visible via labelSnapshot.
 */
export function loggedOutsidePlan(day: ResolvedDay, records: DayRecords, prescribedKeys: string[] = []): ActivityLog[] {
  // Prescribed item keys include requirement keys (`req:<id>`), whose skip records are not orphans.
  const scheduled = new Set([...day.timed, ...day.anytime].map((a) => a.id).concat(prescribedKeys));
  return Object.values(records.activities)
    .filter((log) => !scheduled.has(log.activityId) && (log.status !== 'pending' || log.count > 0))
    .sort((a, b) => a.labelSnapshot.localeCompare(b.labelSnapshot));
}
