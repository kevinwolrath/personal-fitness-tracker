import { hcTypes, type HcType, type HcTypeResult } from './healthConnect';
import type { LocalDate } from '../plan/dates';

/**
 * Health Connect setup (#116, contract 12): for each data type, what the user wants imported, whether Body Anvil
 * may read it, and whether data is actually arriving. Pure: the provider supplies the permissions and the last
 * sync's per-type results; the sheet shows the rows, the fix for each problem, and what changed after a fix.
 *
 * Android doesn't tell an app which other apps may write to Health Connect, so "arriving" is judged only from
 * records actually returned for the synced days.
 */

export type HcSetupStatus =
  /** Not ticked: not asked for, not read. */
  | 'off'
  /** Ticked, but Body Anvil isn't allowed to read it. */
  | 'needs_access'
  /** Allowed, but not read yet (allowed since the last sync). */
  | 'checking'
  /** The last read of it failed. */
  | 'failed'
  /** Allowed and read, but Health Connect had nothing for the synced days. */
  | 'no_data'
  /** Allowed, read, and records arrived. */
  | 'working';

export type HcSetupRow = {
  type: HcType;
  status: HcSetupStatus;
  /** Latest local date with data, when working. */
  latest: LocalDate | null;
  /** Source app slug(s) of the latest data, when working. */
  app: string | null;
};

export const isProblem = (s: HcSetupStatus) => s === 'needs_access' || s === 'failed' || s === 'no_data';

/**
 * What the user wants imported. A stored choice wins. Before one exists (connected before #116), what Health
 * Connect currently allows; before connecting at all, every type.
 */
export function wantedTypes(stored: HcType[] | null, granted: HcType[]): HcType[] {
  const from = stored ?? (granted.length ? granted : hcTypes);
  return hcTypes.filter((t) => from.includes(t));
}

export function setupRows(wanted: HcType[], granted: HcType[], results: Record<string, HcTypeResult> | undefined): HcSetupRow[] {
  return hcTypes.map((type): HcSetupRow => {
    const none = { type, latest: null, app: null };
    if (!wanted.includes(type)) return { ...none, status: 'off' };
    if (!granted.includes(type)) return { ...none, status: 'needs_access' };
    const r = results?.[type];
    if (!r || r.status === 'not_allowed') return { ...none, status: 'checking' };
    if (r.status === 'failed') return { ...none, status: 'failed' };
    if (r.count === 0) return { ...none, status: 'no_data' };
    return { type, status: 'working', latest: r.latest, app: r.app ?? null };
  });
}

/** "4 of 5 working", and which ticked types need a fix (in display order). */
export function setupSummary(rows: HcSetupRow[]): { wanted: number; working: number; problems: HcType[] } {
  const on = rows.filter((r) => r.status !== 'off');
  return { wanted: on.length, working: on.filter((r) => r.status === 'working').length, problems: on.filter((r) => isProblem(r.status)).map((r) => r.type) };
}

export type HcSetupChange = { type: HcType; outcome: 'fixed' | 'still' | 'broke' };

/**
 * What a check changed, per ticked type: a problem that now works (`fixed`), a problem that remains (`still`),
 * or something that worked and no longer does (`broke`). Types ticked or unticked in between are left out.
 */
export function setupChanges(before: HcSetupRow[], after: HcSetupRow[]): HcSetupChange[] {
  const out: HcSetupChange[] = [];
  for (const a of after) {
    const b = before.find((r) => r.type === a.type);
    if (!b || b.status === 'off' || a.status === 'off' || a.status === 'checking') continue;
    if (isProblem(b.status) && a.status === 'working') out.push({ type: a.type, outcome: 'fixed' });
    else if (isProblem(b.status) && isProblem(a.status)) out.push({ type: a.type, outcome: 'still' });
    else if (b.status === 'working' && isProblem(a.status)) out.push({ type: a.type, outcome: 'broke' });
  }
  return out;
}

/**
 * The app most likely meant to write a type that isn't arriving: the app it last came from, else the named app
 * that sends the most other types (on Kevin's phone, Fitbit). Never the phone itself or an unnamed package.
 */
export function likelySourceApp(type: HcType, results: Record<string, HcTypeResult> | undefined, lastApps: Partial<Record<HcType, string>> = {}): string | null {
  const named = (app: string | null | undefined) => (app ?? '').split(',').filter((a) => a && a !== 'phone' && !a.includes('.'));
  const own = named(lastApps[type])[0];
  if (own) return own;
  const counts = new Map<string, number>();
  for (const t of hcTypes) if (t !== type) for (const a of named(results?.[t]?.app)) counts.set(a, (counts.get(a) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0]?.[0] ?? null;
}
