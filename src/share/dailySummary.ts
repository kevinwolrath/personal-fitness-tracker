import { APP_NAME } from '../brand';
import { findInventoryExercise } from '../exercises/inventory';
import { formatMeasurement } from '../format';
import { measurementMetric } from '../observations/planMetrics';
import { parseLocalDate, type LocalDate } from '../plan/dates';
import type { Plan } from '../plan/schema';
import { sessionProgress } from '../prescription/exercises';
import type { PrescriptionItem } from '../prescription/prescribe';
import { exerciseDose } from '../prescription/session';
import type { DayRecords, ExerciseLog } from '../storage/types';

/**
 * "Share this day" (#76): a short, provider-neutral text for ChatGPT, Claude or any app the user picks.
 * Pure and deterministic: the preview shows exactly this string, and exactly this string is shared.
 *
 * Only what was recorded for the selected date: a weigh-in made on that date (never an earlier one carried
 * forward), item states as recorded, the prescribed dose of a ticked session exercise, and logged doses of free
 * exercises. A planned duration is never shown as time done, meals are a checklist (not intake), and anything
 * missing is left out rather than made up.
 */

export const SHARE_INSTRUCTION =
  "Review my daily fitness activity for weight loss. Flag concerns and suggest one practical improvement. Be concise; don't invent missing data.";

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 2 Nov 2026": fixed English, so the text is the same on every device. */
export function shareDate(date: LocalDate): string {
  const d = parseLocalDate(date);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "8:30 am": fixed format, not the device locale's. */
export function shareTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

const isConditioning = (i: PrescriptionItem) => i.kind === 'requirement' || (i.purpose ?? '').startsWith('conditioning');
const nameOf = (movement: string, label?: string) => findInventoryExercise(movement)?.name ?? label ?? movement;

function freeDose(l: ExerciseLog): string {
  if (l.seconds !== null) return `${l.sets} × ${l.seconds} s`;
  if (l.reps !== null) return `${l.sets} × ${l.reps}`;
  return `${l.sets} ${l.sets === 1 ? 'set' : 'sets'}`;
}

/**
 * An item's recorded state in a few words: done / skipped / pending, with rounds when tracked by count. For a
 * requirement, which alternative was done, or started and how far.
 */
function stateOf(i: PrescriptionItem, logs: DayRecords['activities']): string {
  if (i.state === 'skipped') return 'skipped';
  const unitOf = (t: { type: string; unitLabel?: string }) => (t.type === 'count' ? ` ${t.unitLabel}` : '');
  if (i.kind === 'requirement') {
    const rounds = (o: PrescriptionItem['options'][number]) => (o.tracking.type === 'count' ? ` ${logs[o.id]?.count ?? 0} of ${o.tracking.target}${unitOf(o.tracking)}` : '');
    const done = i.satisfiedBy && i.options.find((o) => o.id === i.satisfiedBy!.activityId);
    if (i.state === 'done' && done) return `done (${done.label}${rounds(done)})`;
    const started = i.options.find((o) => (logs[o.id]?.count ?? 0) > 0);
    return started ? `started (${started.label}${rounds(started)})` : 'pending';
  }
  const t = i.activity?.tracking;
  const counted = t?.type === 'count' && i.count !== undefined;
  if (i.state === 'done') return counted ? `done (${i.count} of ${i.target}${unitOf(t!)})` : 'done';
  if (i.state === 'partial' && counted) return `${i.count} of ${i.target}${unitOf(t!)}`;
  return 'pending';
}

export function dailySummary(input: {
  plan: Plan;
  date: LocalDate;
  dayTypeLabel?: string | null;
  items: PrescriptionItem[];
  records: Pick<DayRecords, 'activities' | 'observations'>;
  /** Exercises logged outside sessions on this date. */
  exerciseLogs: ExerciseLog[];
}): string {
  const { plan, date, items, records, exerciseLogs } = input;
  const lines: string[] = [];
  lines.push(`${APP_NAME} — Daily activity — ${shareDate(date)}${input.dayTypeLabel ? ` (${input.dayTypeLabel})` : ''}`);

  // Weight: a weigh-in recorded on this date (latest that day), in the plan's units, and the plan's target if set.
  const weightM = plan.measurements.find((m) => m.quantity === 'mass');
  if (weightM) {
    const weighIns = records.observations
      .filter((o) => o.metric === weightM.id && o.kind === 'observed' && o.date === date)
      .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    const latest = weighIns.at(-1);
    if (latest) {
      const goal = plan.goals.find((g) => g.measurementId === weightM.id);
      const value = formatMeasurement(plan, weightM, measurementMetric(plan, weightM).toPlan(latest.value));
      lines.push(`Weight: ${value}${goal ? ` (target ${formatMeasurement(plan, weightM, goal.target)})` : ''}`);
    }
  }

  // Plan counts: the same rule as the day's progress (required items; a requirement counts once).
  const required = items.filter((i) => i.required);
  if (required.length) {
    const done = required.filter((i) => i.state === 'done').length;
    const skipped = required.filter((i) => i.state === 'skipped').length;
    const pending = required.length - done - skipped;
    lines.push(`Plan: ${done} of ${required.length - skipped} done${skipped ? ` · ${skipped} skipped` : ''}${pending ? ` · ${pending} pending` : ''}`);
  }

  // Strength sessions: exercise by exercise, the ticked ones with their prescribed dose.
  for (const s of items.filter((i) => i.kind === 'activity' && i.session)) {
    if (s.state === 'skipped') {
      lines.push(`${s.label}: skipped`);
      continue;
    }
    const p = sessionProgress(s.session!, records.activities[s.key]);
    const rows = p.rows.filter((r) => !r.optional);
    lines.push(`${s.label} (${p.variant}): ${p.done} of ${p.total} done`);
    const done = rows.filter((r) => r.done).map((r) => `${nameOf(r.exercise.movement, r.exercise.label)} ${exerciseDose(r.exercise)}`.trim());
    const pending = rows.filter((r) => !r.done).map((r) => nameOf(r.exercise.movement, r.exercise.label));
    if (done.length) lines.push(`- done: ${done.join(', ')}`);
    if (pending.length) lines.push(`- pending: ${pending.join(', ')}`);
  }

  if (exerciseLogs.length) {
    const sorted = [...exerciseLogs].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    lines.push(`Extra exercise: ${sorted.map((l) => `${nameOf(l.movement)} ${freeDose(l)}`).join(', ')}`);
  }

  const rest = items.filter((i) => !(i.kind === 'activity' && i.session));
  const conditioning = rest.filter(isConditioning);
  const meals = rest.filter((i) => !isConditioning(i) && i.activity?.kind === 'meal');
  const other = rest.filter((i) => !isConditioning(i) && i.activity?.kind !== 'meal');
  // A label that appears twice on the day (e.g. a morning and an afternoon school run) gets its time.
  const repeated = new Set(items.map((i) => i.label).filter((l, k, all) => all.indexOf(l) !== k));
  const name = (i: PrescriptionItem) => (repeated.has(i.label) && i.window.time ? `${i.label} (${shareTime(i.window.time)})` : i.label);
  const list = (xs: PrescriptionItem[]) => xs.map((i) => `${name(i)} ${stateOf(i, records.activities)}`).join(' · ');
  if (conditioning.length) lines.push(`Conditioning: ${list(conditioning)}`);
  if (meals.length) lines.push(`Meals (checklist, not intake): ${list(meals)}`);
  if (other.length) lines.push(`Other: ${list(other)}`);

  if (lines.length === 1) lines.push('No activity logged.');
  return `${SHARE_INSTRUCTION}\n\n${lines.join('\n')}`;
}
