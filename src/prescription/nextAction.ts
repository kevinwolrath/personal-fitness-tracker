import { isAvailable, type Prescription, type PrescriptionItem } from './prescribe';

export type NextAction = {
  item: PrescriptionItem;
  /** now: its window is open; anytime: no window; overdue: window passed; later: nothing is due yet. */
  status: 'now' | 'anytime' | 'overdue' | 'later';
};

/**
 * What to do now (contract 08). Deterministic, from the prescription and the local time only:
 * open (pending/partial) items whose `after` dependencies are resolved, ranked
 *   required & current → required & anytime → required & overdue →
 *   optional & current → optional & anytime → optional & overdue → anything upcoming (earliest first),
 * ties by window start, then plan order.
 */
export function nextAction(p: Prescription, nowMinutes: number): NextAction | null {
  const open = p.items.filter((i) => (i.state === 'pending' || i.state === 'partial') && isAvailable(i, p.items));
  const classify = (i: PrescriptionItem): NextAction['status'] => {
    if (i.window.part === 'anytime') return 'anytime';
    if (nowMinutes < i.window.start) return 'later';
    if (nowMinutes > i.window.end) return 'overdue';
    return 'now';
  };
  const rank = (i: PrescriptionItem) => {
    const s = classify(i);
    if (s === 'later') return 6;
    const base = { now: 0, anytime: 1, overdue: 2 }[s];
    return i.required ? base : base + 3;
  };
  const best = [...open].sort((a, b) => rank(a) - rank(b) || a.window.start - b.window.start || a.order - b.order)[0];
  return best ? { item: best, status: classify(best) } : null;
}
