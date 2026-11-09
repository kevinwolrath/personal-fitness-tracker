import type { Observation } from './types';

/** A rapid correction must sort after the previous entry even with a fixed/coarse device clock. */
export function nextRecordedAt(now: Date, entries: Observation[]): string {
  const latest = entries.reduce((n,o) => {
    const at = Date.parse(o.recordedAt);
    return Number.isFinite(at) ? Math.max(n,at) : n;
  }, -Infinity);
  return new Date(Math.max(now.getTime(),latest+1)).toISOString();
}
