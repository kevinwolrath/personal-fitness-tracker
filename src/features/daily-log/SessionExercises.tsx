import { StyleSheet, Text, View } from 'react-native';
import { exerciseDose, type PrescribedExercise } from '../../prescription/session';
import { colors, space, type } from '../../ui/theme';

/** Structured session lines: "Kettlebell squat · 3 × 10 · 16 kg", with substitutions and cautions called out. */
export function SessionExercises({ exercises, testID }: { exercises: PrescribedExercise[]; testID?: string }) {
  return (
    <View style={styles.list} testID={testID}>
      {exercises.map((e, i) => (
        <View key={`${e.movement}-${i}`} style={styles.row}>
          <View style={styles.name}>
            <Text style={[styles.label, e.avoid && styles.avoid]}>{e.label}</Text>
            {e.substitutedFor ? <Text style={type.detail}>instead of {e.substitutedFor.toLowerCase()}</Text> : null}
            {e.caution ? <Text style={type.detail}>caution</Text> : null}
            {e.avoid ? <Text style={type.detail}>marked avoid · no substitute set</Text> : null}
          </View>
          <Text style={styles.dose}>{exerciseDose(e)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  name: { flex: 1, minWidth: 0 },
  label: { fontSize: 15, fontWeight: '600', color: colors.ink },
  avoid: { textDecorationLine: 'line-through', color: colors.muted },
  dose: { fontSize: 15, color: colors.muted, fontVariant: ['tabular-nums'], flexShrink: 0 },
});
