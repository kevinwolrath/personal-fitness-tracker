import { Text, View } from 'react-native';
import type { ExerciseGuide } from '../../exercises/guide';
import { createThemedStyles, radius, space, useTheme } from '../../ui/theme';
import { MuscleMap } from './MuscleMap';
export function ExerciseMuscles({ muscles, gender }: { muscles: ExerciseGuide['muscles']; gender?: unknown }) {
  const { type } = useTheme();
  const styles = useStyles();
  if (!muscles) return <Text style={type.detail} testID="guide-no-muscle-mapping">Muscle mapping unavailable for this exercise.</Text>;
  const labels = (list: { label: string }[]) => list.map(muscle => muscle.label).join(', ') || 'None';
  return <View style={styles.strip} testID="guide-activation">
    <Text style={type.section}>Muscles used</Text>
    <View style={styles.row}>
      <View style={styles.map}><MuscleMap gender={gender} mode="activated" activated={muscles.primary.map(muscle => muscle.id)} secondary={muscles.secondary.map(muscle => muscle.id)} strip /></View>
      <View style={styles.labels}>
        <Text style={styles.primary} testID="guide-primary-muscles">Primary: {labels(muscles.primary)}</Text>
        <Text style={type.detail} testID="guide-secondary-muscles">Secondary: {labels(muscles.secondary)}</Text>
        <Text style={styles.legend}>● Primary · dashed secondary. Activation only; no work logged.</Text>
      </View>
    </View>
  </View>;
}
const useStyles = createThemedStyles(({ colors, type }) => ({
  strip: { gap: space.sm, padding: space.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.bg },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  map: { width: 136, flexShrink: 0 },
  labels: { flexGrow: 1, flexBasis: 130, gap: space.sm },
  primary: { ...type.detail, color: colors.ink, fontWeight: '600' },
  legend: { ...type.detail, fontSize: 12 },
}));
