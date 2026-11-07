import { speakEnergy } from '../../energy';
import { StyleSheet, Text, View } from 'react-native';
import type { MealView } from '../../plan/meals';
import { space, useTheme, createThemedStyles } from '../../ui/theme';

/**
 * "What exactly am I eating, and how much?" (#26). Renders a MealView from the plan: ingredient,
 * target amount and the plan's own everyday measure, how to make it, and the meal's energy/protein.
 * `card` sits inside the ink "Do this next" card; `sheet` is the full view in the details sheet.
 */
export function MealDetails({ meal, variant, testID }: { meal: MealView; variant: 'card' | 'sheet'; testID?: string }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const onInk = variant === 'card';
  return (
    <View style={styles.wrap} testID={testID}>
      {meal.ingredients.length > 0 && (
        <View style={[styles.list, onInk && styles.listOnInk]} testID={testID && `${testID}-ingredients`}>
          {meal.ingredients.map((g, i) => (
            <View
              key={`${g.name}-${i}`}
              style={[styles.row, i > 0 && styles.divider]}
              accessible
              accessibilityLabel={[g.name, g.amount, g.measure].filter(Boolean).join(', ')}
            >
              <Text style={styles.name}>{g.name}</Text>
              <View style={styles.qty}>
                {g.amount ? <Text style={styles.amount}>{g.amount}</Text> : null}
                {g.measure ? <Text style={[styles.measure, !g.amount && styles.measureOnly]}>{g.measure}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      )}
      {meal.preparation ? (
        <View style={styles.prep}>
          {!onInk && <Text style={type.section}>How to make it</Text>}
          <Text style={onInk ? styles.prepOnInk : styles.prepText} testID={testID && `${testID}-preparation`}>
            {meal.preparation}
          </Text>
        </View>
      ) : null}
      {meal.nutrition ? (
        <Text
          style={onInk ? styles.nutritionOnInk : styles.nutrition}
          accessibilityLabel={speakEnergy(meal.nutrition)}
          testID={testID && `${testID}-nutrition`}
        >
          {meal.nutrition}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  wrap: { gap: space.sm },
  list: { borderRadius: 16, backgroundColor: colors.surface },
  listOnInk: { paddingHorizontal: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingVertical: space.xs },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600', color: colors.ink },
  qty: { alignItems: 'flex-end', flexShrink: 0, maxWidth: '50%' },
  amount: { fontSize: 15, fontWeight: '800', color: colors.ink, fontVariant: ['tabular-nums'] },
  measure: { fontSize: 14, color: colors.muted, textAlign: 'right' },
  measureOnly: { fontSize: 15, color: colors.ink },
  prep: { gap: space.xs },
  prepText: { ...type.body, fontSize: 16, fontWeight: '400', lineHeight: 23 },
  prepOnInk: { fontSize: 15, lineHeight: 21, color: colors.onCard },
  nutrition: { ...type.detail, fontSize: 15, color: colors.ink, ...type.number },
  nutritionOnInk: { fontSize: 14, color: colors.onInkMuted, ...type.number },
}));
