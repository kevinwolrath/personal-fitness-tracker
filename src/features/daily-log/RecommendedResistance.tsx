import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import type { ResistanceRecommendation } from '../../exercises/recommendedResistance';
import type { WorkoutRow } from '../../exercises/todayWorkout';
import { buildGuide } from '../../exercises/guide';
import { exerciseArtwork } from '../../exercises/heroIllustrations';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';

/** Layout A: one explainable optional group; no required task or independent logging state. */
export function RecommendedResistance({ recommendation, loading, gender, onLog, onGuide }: {
  recommendation: ResistanceRecommendation; loading: boolean; gender?: string; onLog: (row: WorkoutRow) => void; onGuide: (row: WorkoutRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const styles = useStyles();
  const { type } = useTheme();
  const description = loading ? 'Checking recorded training' : recommendation.kind === 'ready' ? `${recommendation.label}. Optional. ${recommendation.reason}` : recommendation.reason;
  return <View style={styles.card} testID="recommended-resistance">
    <Pressable accessibilityRole="button" accessibilityLabel={`Recommended Resistance Training. ${description}`} accessibilityState={{ expanded, disabled: loading || recommendation.kind !== 'ready' }} disabled={loading || recommendation.kind !== 'ready'} onPress={() => setExpanded(!expanded)} style={styles.header} testID="recommendation-expand">
      <View style={styles.body}><Text style={styles.title}>Recommended Resistance Training</Text>
        {loading ? <Text style={type.detail}>Checking recorded training…</Text> : recommendation.kind === 'ready' ? <><Text style={styles.group} testID="recommended-muscle">{recommendation.label} <Text style={type.detail}>· Optional</Text></Text><Text style={type.detail} testID="recommendation-reason">{recommendation.reason}</Text><Text style={styles.action}>{expanded ? 'Hide exercises' : 'See matching exercises'}</Text></> : <Text style={type.detail}>{recommendation.reason}</Text>}
      </View>{!loading && recommendation.kind === 'ready' && <Text style={styles.action}>{expanded ? '⌃' : '⌄'}</Text>}
    </Pressable>
    {!loading && expanded && recommendation.kind === 'ready' && <View testID="recommended-exercises">
      <Text style={styles.intro}>With your available equipment · best match first</Text>
      {recommendation.rows.map(row => {
        const guide = buildGuide({ movement: row.movement, label: row.name });
        const image = guide.steps[0] && exerciseArtwork(guide.steps[0].image, gender);
        return <View key={row.movement} style={styles.row} testID={`recommendation-row-${row.movement}`}>
          {image?.isPose ? <Image source={image.source} style={styles.image} resizeMode="contain" accessible={false} /> : <Text style={styles.missing}>Illustration unavailable</Text>}
          <View style={styles.body}><Text style={styles.name}>{row.name}</Text><Text style={type.detail}>{row.doseLabel}{row.caution ? ' · Caution' : ''}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Log optional ${row.name}`} onPress={() => onLog(row)} style={styles.control}><Text style={styles.action}>Log</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`${row.name}. Show how`} onPress={() => onGuide(row)} style={styles.control}><Text style={styles.action}>ⓘ</Text></Pressable>
        </View>;
      })}
      <Text style={styles.intro}>Optional. Logged once in your existing exercise log. Your schedule stays as planned.</Text>
    </View>}
  </View>;
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  card: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.md, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch },
  body: { flex: 1 }, title: { ...type.body, fontSize: 15 },
  group: { ...type.body, fontSize: 21, marginVertical: space.sm },
  action: { ...type.body, fontSize: 13, color: colors.primary, paddingVertical: space.sm },
  intro: { ...type.detail, marginVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1, borderColor: colors.line },
  image: { width: 40, height: 56, borderRadius: radius.sm },
  missing: { ...type.detail, width: 40, fontSize: 10 },
  name: { ...type.body, fontSize: 15 }, control: { minWidth: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center' },
}));
