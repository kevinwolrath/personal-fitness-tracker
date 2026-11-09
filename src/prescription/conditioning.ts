import { formatDuration } from '../format';
import type { Activity } from '../plan/schema';
import type { ActivityLog } from '../storage/types';
import type { PrescriptionItem } from './prescribe';

/**
 * A requirement with alternatives as one choice (#90, contract 08): which method is in progress or done, and each
 * method's dose in the plan's own words. Pure. Completion stays "any one, once" (prescribe.ts): this only describes it.
 */

export type OptionState = 'done' | 'active' | 'idle' | 'not-needed';

export type RequirementOption = {
  activity: Activity;
  /** "3 rounds · Thrill of the Fight · 3-minute rounds", "12 min · 3 × 3-minute rounds": from the plan, never invented. */
  dose: string | null;
  progress: { count: number; target: number; unit: string } | null;
  state: OptionState;
};

export type RequirementView = {
  options: RequirementOption[];
  /** The method being done (partial) or that completed it. */
  chosen: RequirementOption | null;
  /** The row's one-line status: "VR boxing · 1 of 3 rounds", "Done with VR boxing · 3 rounds". */
  status: string;
};

export function optionDose(a: Activity): string | null {
  const amount = a.tracking.type === 'count' ? `${a.tracking.target} ${a.tracking.unitLabel}` : formatDuration(a.duration);
  return [amount, a.detail].filter(Boolean).join(' · ') || null;
}

export function requirementView(item: PrescriptionItem, logs: Record<string, ActivityLog | undefined>): RequirementView {
  const doneId = item.satisfiedBy?.activityId ?? null;
  // In progress: the latest-updated option with partial progress (a switch moves the highlight to the new method).
  const active = doneId
    ? null
    : item.options
        .filter((o) => (logs[o.id]?.count ?? 0) > 0 && logs[o.id]?.status !== 'done')
        .sort((a, b) => logs[b.id]!.updatedAt.localeCompare(logs[a.id]!.updatedAt))[0]?.id ?? null;
  const options = item.options.map((o): RequirementOption => {
    const log = logs[o.id];
    const progress = o.tracking.type === 'count' ? { count: log?.count ?? 0, target: o.tracking.target, unit: o.tracking.unitLabel } : null;
    const state: OptionState = o.id === doneId ? 'done' : doneId ? 'not-needed' : o.id === active ? 'active' : 'idle';
    return { activity: o, dose: optionDose(o), progress, state };
  });
  const chosen = options.find((o) => o.state === 'done' || o.state === 'active') ?? null;
  const amount = (o: RequirementOption) =>
    o.progress ? (o.state === 'done' ? `${o.progress.target} ${o.progress.unit}` : `${o.progress.count} of ${o.progress.target} ${o.progress.unit}`) : formatDuration(o.activity.duration);
  const status =
    item.state === 'skipped'
      ? 'Skipped'
      : chosen?.state === 'done'
        ? ['Done with ' + chosen.activity.label, amount(chosen)].filter(Boolean).join(' · ')
        : chosen
          ? [chosen.activity.label, amount(chosen)].filter(Boolean).join(' · ')
          : item.options.length > 1
            ? 'Pick one · any one counts for today'
            : item.detail ?? '';
  return { options, chosen, status };
}
