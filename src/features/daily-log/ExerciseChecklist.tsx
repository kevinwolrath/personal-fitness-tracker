import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChecklistRow, SessionProgress, Variant } from '../../prescription/exercises';
import type { PrescribedExercise } from '../../prescription/session';
import { exerciseDose } from '../../prescription/session';
import type { ExerciseSection } from '../../plan/schema';
import { movementSupported } from '../../exercises/availability';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';

type Props = {
  rows: ChecklistRow[];
  equipmentConfig?: ExerciseSection;
  /** Highlight this row as the next one to do. */
  nextKey?: string | null;
  editable: boolean;
  onToggle: (row: ChecklistRow) => void;
  /** Opens the exercise guide (contract 09). Never changes completion. */
  onOpen?: (e: PrescribedExercise) => void;
  /** Small "Next" label above the exercise name (the collapsed card's single row). */
  labelNext?: boolean;
  /**
   * #122 Muscle Growth: each row also offers Skip, and a skipped row offers Undo. Skipped is not done: ticking a
   * skipped row completes it instead. Sessions don't pass this, so their rows are unchanged.
   */
  onSkip?: (row: ChecklistRow) => void;
  testID?: string;
};

/**
 * Exercise-by-exercise checklist (#28). The circle (48 dp) ticks that exercise only; the rest of the row
 * opens its guide. Done exercises stay visible, struck through.
 */
export function ExerciseChecklist({ equipmentConfig, rows, nextKey, editable, onToggle, onOpen, labelNext, onSkip, testID }: Props) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.list} testID={testID}>
      {rows.map((row, i) => {
        const e = row.exercise;
        const dose = exerciseDose(e);
        const isNext = row.key === nextKey;
        return (
          <View key={row.key} style={[styles.row, i > 0 && styles.divider, isNext && !labelNext && styles.nextRow]} testID={`check-${row.key}`}>
            {row.optional ? (
              <View style={styles.circle} />
            ) : (
              <Pressable
                onPress={() => onToggle(row)}
                disabled={!editable}
                style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
                role="checkbox"
                aria-checked={row.done}
                aria-disabled={!editable}
                aria-label={`${e.label}, ${dose}`}
              >
                <View style={[styles.mark, row.done && styles.markDone, isNext && !row.done && styles.markNext]}>
                  {row.done ? <Text style={styles.tick}>✓</Text> : null}
                </View>
              </Pressable>
            )}
            <Pressable
              onPress={onOpen ? () => onOpen(e) : undefined}
              disabled={!onOpen}
              style={({ pressed }) => [styles.body, pressed && styles.pressed]}
              accessibilityRole={onOpen ? 'button' : undefined}
              accessibilityLabel={onOpen ? `${e.label}, ${dose}. Show how` : undefined}
              testID={`exercise-${e.movement}`}
            >
              <View style={styles.name}>
                {labelNext ? <Text style={styles.nextLabel}>Next</Text> : null}
                <Text style={[styles.label, (row.done || row.skipped) && styles.labelDone, e.avoid && styles.avoid, isNext && styles.labelNext]}>{e.label}</Text>
                {row.skipped ? <Text style={type.detail}>skipped</Text> : null}
                {e.substitutedFor ? <Text style={type.detail}>instead of {e.substitutedFor.toLowerCase()}</Text> : null}
                {equipmentConfig && !movementSupported(e.movement, equipmentConfig) ? <Text style={type.detail}>Equipment unavailable · review My Gym</Text> : null}
                {e.caution ? <Text style={type.detail}>caution</Text> : null}
                {row.optional ? <Text style={type.detail}>marked avoid · not required</Text> : null}
              </View>
              <Text style={styles.dose}>{dose}</Text>
              {onOpen ? <Text style={styles.info}>ⓘ</Text> : null}
            </Pressable>
            {onSkip && !row.done ? (
              <Pressable
                onPress={() => onSkip(row)}
                disabled={!editable}
                style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={row.skipped ? `Undo skip: ${e.label}` : `Skip ${e.label}`}
                testID={`skip-${row.key}`}
              >
                <Text style={styles.skipText}>{row.skipped ? 'Undo' : 'Skip'}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/** Full / Short: an explicit choice (never inferred from ticks). */
export function VersionSwitch({
  progress,
  fullMinutes,
  shortMinutes,
  editable,
  onChoose,
  onInk,
}: {
  progress: SessionProgress;
  fullMinutes?: number;
  shortMinutes?: number;
  editable: boolean;
  onChoose: (v: Variant) => void;
  onInk?: boolean;
}) {
  const styles = useStyles();

  const option = (v: Variant, label: string) => {
    const on = progress.variant === v;
    return (
      <Pressable
        key={v}
        onPress={() => !on && onChoose(v)}
        disabled={!editable}
        style={[styles.segment, on && (onInk ? styles.segmentOnInk : styles.segmentOn)]}
        role="radio"
        aria-checked={on}
        aria-label={label}
      >
        <Text style={[styles.segmentText, onInk && styles.segmentTextInk, on && styles.segmentTextOn]}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={[styles.segments, onInk && styles.segmentsInk]} role="radiogroup" aria-label="Version" testID="version-switch">
      {option('full', `Full${fullMinutes ? ` · ${fullMinutes} min` : ''}`)}
      {option('short', `Short${shortMinutes ? ` · ${shortMinutes} min` : ''}`)}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  list: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: touch },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  nextRow: { backgroundColor: colors.accentSoft },
  circle: { width: touch, minHeight: touch, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  mark: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  markNext: { borderColor: colors.accent },
  markDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontWeight: '900', fontSize: 14 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch, paddingVertical: space.xs, paddingRight: space.sm },
  name: { flex: 1, minWidth: 0 },
  nextLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink },
  labelNext: { fontWeight: '800' },
  labelDone: { color: colors.muted, textDecorationLine: 'line-through', fontWeight: '500' },
  avoid: { textDecorationLine: 'line-through', color: colors.muted },
  dose: { fontSize: 15, color: colors.muted, fontVariant: ['tabular-nums'], flexShrink: 0 },
  info: { fontSize: 16, color: colors.accent, width: 18, textAlign: 'center' },
  skip: { minHeight: touch, minWidth: touch, paddingHorizontal: space.sm, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, fontWeight: '700', color: colors.accent },
  segments: { flexDirection: 'row', backgroundColor: colors.line, borderRadius: radius.sm + 2, padding: 3 },
  segmentsInk: { backgroundColor: colors.inkRaised },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.surface },
  segmentOnInk: { backgroundColor: colors.surface },
  segmentText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  segmentTextInk: { color: colors.onInkMuted },
  segmentTextOn: { color: colors.ink, fontWeight: '800' },
}));
