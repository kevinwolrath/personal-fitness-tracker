import type { Observation } from './types';

export const isHealthActivity = (o: Observation) => o.metric === 'exercise_session' && o.kind === 'observed' && o.source.type === 'integration' && o.source.importId === 'health-connect';
export const isWalk = (o: Observation) => isHealthActivity(o) && (o.activity?.exerciseType === 79 || (o.activity?.exerciseType === undefined && /\bwalk(?:ing)?\b/i.test(o.label ?? '')));
export const interval = (o: Observation): [number, number] | null => {
  const start = Date.parse(o.activity?.start ?? o.source.capturedAt ?? '');
  // Legacy imports retained a start and rounded minutes, but no end. No distance is inferred.
  const end = o.activity ? Date.parse(o.activity.end) : start + o.value * 60000;
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? [start, end] : null;
};
const overlap = (a: [number, number], b: [number, number]) => Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

/** Projection only: raw observations and their source IDs remain available for drill-down. */
export function activitySummary(input: Observation[]) {
  const records = [...new Map(input.map(o => [o.id, o])).values()];
  const ordered = [...records].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const unique: Observation[] = [], duplicates = new Set<string>();
  for (const o of ordered) {
    const span = interval(o);
    const duplicate = span && unique.some(k => {
      const other = interval(k);
      const compatible = !o.activity?.exerciseType || !k.activity?.exerciseType || o.activity.exerciseType === k.activity.exerciseType;
      return other && compatible && overlap(span, other) > .5 * Math.min(span[1] - span[0], other[1] - other[0]);
    });
    if (duplicate) duplicates.add(o.id); else unique.push(o);
  }
  const spans = records.map(interval).filter((s): s is [number, number] => !!s).sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const untimed = records.filter(o => !interval(o));
  // Unknown timing cannot justify adding durations. Show a conservative lower bound instead.
  const minutes = Math.max(merged.reduce((sum, [a, b]) => sum + (b - a) / 60000, 0), ...untimed.map(o => Math.max(0, o.value)), 0);
  const distances: Observation[] = [];
  for (const o of ordered.filter(o => Number.isFinite(o.activity?.distanceMeters) && o.activity!.distanceMeters! >= 0)) {
    const span = interval(o);
    if (span && !distances.some(k => overlap(span, interval(k)!) > 0)) distances.push(o);
  }
  const metres = distances.length ? distances.reduce((sum, o) => sum + o.activity!.distanceMeters!, 0) : null;
  const partialDistance = metres !== null && (
    distances.length < unique.length || records.some(o => o.activity?.distancePartial) ||
    records.filter(o => o.activity?.distanceMeters !== undefined).length > distances.length
  );
  return {
    records, unique, duplicates, minutes, metres, partialDistance,
    uncertainTime: untimed.length > 0,
    overlap: spans.reduce((sum, [a, b]) => sum + (b - a) / 60000, 0) > minutes + .01,
  };
}
