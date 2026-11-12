import { Pressable, Text, View } from 'react-native';
import type { MuscleCoverage } from '../../exercises/coverage';
import type { MuscleGrowthDay, MuscleGrowthRow } from '../../exercises/catalogue';
import type { Inventory } from '../../exercises/inventory';
import type { ChecklistRow } from '../../prescription/exercises';
import type { PrescribedExercise } from '../../prescription/session';
import { createThemedStyles, space, touch, useTheme } from '../../ui/theme';
import { ExerciseChecklist } from './ExerciseChecklist';

const partLabel: Record<string, string> = { morning: 'Morning', lunch: 'Lunch break', afternoon: 'Afternoon', evening: 'Evening', anytime: 'Any time' };
const statusWord: Record<string, string> = { green: 'trained', amber: 'building', red: 'due', unknown: 'not enough history', recovering: 'recovering', unavailable: 'unavailable' };

/** The checklist row for one Muscle Growth item: the same row the session checklist uses (#28), plus skip state. */
export const growthChecklistRow = (r: MuscleGrowthRow): ChecklistRow => ({
  key: r.movement,
  exercise: toPrescribed(r),
  done: r.status === 'done',
  skipped: r.status === 'skipped',
  optional: false,
});
export const toPrescribed = (r: MuscleGrowthRow): PrescribedExercise => ({
  movement: r.movement,
  label: r.name,
  sets: r.log && r.status === 'done' ? r.log.sets : r.planned.sets,
  ...(r.status === 'done' && r.log ? { ...(r.log.reps ? { reps: r.log.reps } : {}), ...(r.log.seconds ? { seconds: r.log.seconds } : {}), ...(r.log.loadKg ? { loadKg: r.log.loadKg } : {}) } : { ...(r.planned.reps ? { reps: r.planned.reps } : {}), ...(r.planned.seconds ? { seconds: r.planned.seconds } : {}), ...(r.planned.loadKg ? { loadKg: r.planned.loadKg } : {}) }),
  ...(r.caution ? { caution: true } : {}),
});

/**
 * Muscle Growth (#122): its own section in the Daily Log's content layer, separate from Today's workout. The routine's
 * exercises as the shared exercise checklist, each with Complete (the circle) and Skip. Completion is saved per date;
 * the muscle load is the same accounting as every other exercise. Presentation only: rows come from `muscleGrowthDay`.
 */
export function MuscleGrowthSection({ day, when, inventory, coverage, hints, editable, onComplete, onSkip, onGuide, onDetails, onEdit }: {
  day: MuscleGrowthDay;
  when?: string;
  inventory: Inventory;
  /** Today's muscle coverage (weekly effective sets per target, both categories); null on other dates. */
  coverage: MuscleCoverage[] | null;
  /** Progression suggestions by movement (never applied automatically). */
  hints: Record<string, string>;
  editable: boolean;
  onComplete: (r: MuscleGrowthRow) => void;
  onSkip: (r: MuscleGrowthRow) => void;
  onGuide: (e: PrescribedExercise) => void;
  onDetails: (r: MuscleGrowthRow) => void;
  onEdit: () => void;
}) {
  const { type } = useTheme();
  const styles = useStyles();
  const label = new Map(inventory.muscleGroups.map((m) => [m.id, m.label]));
  const byKey = new Map(day.rows.map((r) => [r.movement, r]));
  const counts = day.rows.length
    ? [`${day.done} of ${day.rows.length} done`, day.skipped ? `${day.skipped} skipped` : '', day.remaining ? `${day.remaining} left` : ''].filter(Boolean).join(' · ')
    : 'No exercises chosen yet';
  const workload = coverage
    ? day.targets
        .map((t) => coverage.find((c) => c.muscle === t))
        .filter((c): c is MuscleCoverage => !!c)
        .map((c) => `${c.label} ${Math.round(c.volume * 10) / 10} sets (${c.report ?? statusWord[c.status] ?? c.status})`)
    : [];
  const done = day.rows.filter((r) => r.status === 'done');
  return (
    <View style={styles.block} testID="muscle-growth">
      <View style={styles.head}>
        <View style={styles.flex}>
          <Text style={type.section} accessibilityRole="header">
            Muscle Growth
          </Text>
          <Text style={type.detail} testID="muscle-growth-summary">
            {[day.targets.map((t) => label.get(t) ?? t).join(' · '), when ? partLabel[when] : ''].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable onPress={onEdit} style={styles.edit} accessibilityRole="button" accessibilityLabel="Edit Muscle Growth routine" testID="muscle-growth-edit">
          <Text style={styles.link}>Edit</Text>
        </Pressable>
      </View>
      <Text style={type.body} testID="muscle-growth-counts">
        {counts}
      </Text>
      {!!day.equipmentReview?.length && <Text style={type.detail} testID="muscle-growth-equipment-review">Review My Gym equipment for {day.equipmentReview.join(', ')}. Your routine and its doses are kept.</Text>}
      {workload.length > 0 && (
        <Text style={type.detail} testID="muscle-growth-workload">
          This week, all training: {workload.join(' · ')}
        </Text>
      )}
      {day.rows.length > 0 && (
        <ExerciseChecklist
          rows={day.rows.map(growthChecklistRow)}
          editable={editable}
          onToggle={(row) => onComplete(byKey.get(row.key)!)}
          onSkip={(row) => onSkip(byKey.get(row.key)!)}
          onOpen={onGuide}
          testID="muscle-growth-list"
        />
      )}
      {done.map((r) => (
        <Pressable
          key={r.movement}
          onPress={() => onDetails(r)}
          disabled={!editable}
          style={styles.detailRow}
          accessibilityRole="button"
          accessibilityLabel={`Log details for ${r.name}`}
          testID={`muscle-growth-details-${r.movement}`}
        >
          <Text style={[type.detail, styles.flex]}>
            {r.name}: {r.log?.sets} × {r.log?.reps ?? `${r.log?.seconds} s`}
            {r.log?.loadKg ? ` · ${r.log.loadKg} kg` : ''}
            {r.log?.rir !== undefined && r.log?.rir !== null ? ` · ${r.log.rir} in reserve` : ''}
          </Text>
          <Text style={styles.link}>{editable ? 'Details' : ''}</Text>
        </Pressable>
      ))}
      {Object.entries(hints)
        .filter(([m]) => byKey.has(m))
        .map(([m, h]) => (
          <Text key={m} style={type.detail} testID={`muscle-growth-hint-${m}`}>
            {byKey.get(m)!.name}: {h}
          </Text>
        ))}
    </View>
  );
}


const useStyles = createThemedStyles(({ colors }) => ({
  block: { gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
  edit: { minHeight: touch, minWidth: touch, alignItems: 'center', justifyContent: 'center' },
  link: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
}));
