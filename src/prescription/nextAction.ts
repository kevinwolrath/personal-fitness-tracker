import { isAvailable, type Prescription, type PrescriptionItem } from './prescribe';

export type NextAction = {
  item: PrescriptionItem;
  /**
   * now: its window is open (an exact time inside its lead/duration window, or inside its plan-defined day part);
   * later: nothing is due yet and a timed item becomes due within the preview horizon (#51, #41): a preview only, never offered for completion.
   */
  status: 'now' | 'later';
};

/** "Up next" previews only a timed item that becomes due within this many minutes (#41). */
export const UP_NEXT_HORIZON_MINUTES = 60;

/** Whether the card may show the item's details and completion controls (#51). */
export const isDue = (n: NextAction | null) => !!n && n.status === 'now';

const isOpen = (i: PrescriptionItem) => i.state === 'pending' || i.state === 'partial';
const isTimed = (i: PrescriptionItem) => i.window.time !== null;

/**
 * How long the item takes, when the plan says (#41): a session's minutes for the chosen version,
 * else the activity's duration; a requirement takes its quickest alternative. Undefined when unknown.
 */
export function estimatedMinutes(i: PrescriptionItem): number | undefined {
  const ofActivity = (a: NonNullable<PrescriptionItem['activity']>, variant?: 'full' | 'short') => {
    if (variant === 'short' && a.session?.short?.minutes) return a.session.short.minutes;
    if (a.session?.minutes) return a.session.minutes;
    if (a.duration) return 'minutes' in a.duration ? a.duration.minutes : a.duration.max;
    return undefined;
  };
  if (i.activity) return ofActivity(i.activity, i.variant);
  const all = i.options.map((o) => ofActivity(o)).filter((m): m is number => m !== undefined);
  return all.length === i.options.length && all.length ? Math.min(...all) : undefined;
}

/**
 * What should I reasonably do now? (contract 08, #41). Deterministic, from the prescription and the local time only.
 *
 * Candidates are open (pending/partial) items whose `after` dependencies are resolved and whose window is open now.
 * Never promoted: overdue items, anytime items (required or optional), and a day-part item whose estimated duration
 * doesn't fit before its part ends or the next fixed-time item becomes due. A day part is necessary but not proof
 * the user is free, so the duration check only rules a window out; a calendar gap never creates one.
 * Rank: required → exact time before day part → becomes due earliest → scheduled time → plan order.
 *
 * Nothing due: a timed item that becomes due within {@link UP_NEXT_HORIZON_MINUTES} is previewed (`later`).
 * Otherwise null, and the card is hidden. Nothing here removes or changes items in the day's checklist.
 */
export function nextAction(p: Prescription, nowMinutes: number): NextAction | null {
  const open = p.items.filter((i) => isOpen(i) && isAvailable(i, p.items));

  // The next fixed-time commitment: when the earliest unresolved timed item still to come becomes due.
  const nextCommitment = (self: PrescriptionItem) =>
    Math.min(...p.items.filter((i) => i !== self && isOpen(i) && isTimed(i) && i.window.start > nowMinutes).map((i) => i.window.start), Infinity);

  const dueNow = (i: PrescriptionItem) => {
    const w = i.window;
    if (w.part === 'anytime' || nowMinutes < w.start || nowMinutes > w.end) return false;
    if (isTimed(i)) return true; // scheduled: respect its own lead window, no fit check
    const minutes = estimatedMinutes(i);
    return minutes === undefined || nowMinutes + minutes <= Math.min(w.end, nextCommitment(i));
  };

  const due = open
    .filter(dueNow)
    .sort(
      (a, b) =>
        Number(b.required) - Number(a.required) ||
        Number(isTimed(b)) - Number(isTimed(a)) ||
        a.window.start - b.window.start ||
        a.window.at - b.window.at ||
        a.order - b.order,
    )[0];
  if (due) return { item: due, status: 'now' };

  const upcoming = open
    .filter((i) => isTimed(i) && i.window.start > nowMinutes && i.window.start - nowMinutes <= UP_NEXT_HORIZON_MINUTES)
    .sort((a, b) => a.window.start - b.window.start || Number(b.required) - Number(a.required) || a.window.at - b.window.at || a.order - b.order)[0];
  return upcoming ? { item: upcoming, status: 'later' } : null;
}
