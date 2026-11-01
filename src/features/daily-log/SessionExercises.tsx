import { Pressable, StyleSheet, Text, View } from 'react-native';
import { exerciseDose, type PrescribedExercise } from '../../prescription/session';
import { colors, space, touch, type } from '../../ui/theme';

/** Structured session lines: "Kettlebell squat · 3 × 10 · 16 kg", with substitutions and cautions called out. */
export function SessionExercises({
  exercises,
  testID,
  onOpen,
}: {
  exercises: PrescribedExercise[];
  testID?: string;
  /** Opens the exercise guide (contract 09). Browsing never changes completion. */
  onOpen?: (e: PrescribedExercise) => void;
}) {
  return (
    <View style={styles.list} testID={testID}>
      {exercises.map((e, i) => (
        <Pressable
          key={`${e.movement}-${i}`}
          onPress={onOpen ? () => onOpen(e) : undefined}
          disabled={!onOpen}
          style={({ pressed }) => [styles.row, onOpen && styles.tappable, pressed && styles.pressed]}
          accessibilityRole={onOpen ? 'button' : undefined}
          accessibilityLabel={onOpen ? `${e.label}, ${exerciseDose(e)}. Show how` : undefined}
          testID={`exercise-${e.movement}`}
        >
          <View style={styles.name}>
            <Text style={[styles.label, e.avoid && styles.avoid]}>{e.label}</Text>
            {e.substitutedFor ? <Text style={type.detail}>instead of {e.substitutedFor.toLowerCase()}</Text> : null}
            {e.caution ? <Text style={type.detail}>caution</Text> : null}
            {e.avoid ? <Text style={type.detail}>marked avoid · no substitute set</Text> : null}
          </View>
          <Text style={styles.dose}>{exerciseDose(e)}</Text>
          {onOpen ? <Text style={styles.info}>ⓘ</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  tappable: { minHeight: touch, alignItems: 'center' },
  pressed: { opacity: 0.6 },
  info: { fontSize: 16, color: colors.accent, width: 18, textAlign: 'center' },
  name: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink },
  avoid: { textDecorationLine: 'line-through', color: colors.muted },
  dose: { fontSize: 15, color: colors.muted, fontVariant: ['tabular-nums'], flexShrink: 0 },
});
