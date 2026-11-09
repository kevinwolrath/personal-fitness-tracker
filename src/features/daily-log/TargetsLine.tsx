import { StyleSheet, Text, View } from 'react-native';
import { speakEnergy, type EnergyDisplay } from '../../energy';
import { formatClock, formatTarget } from '../../format';
import type { NutritionTarget, Plan } from '../../plan/schema';
import { space, useTheme } from '../../ui/theme';

/** Daily nutrition targets + eating window as quiet text (display only). */
export function TargetsLine({ plan, targets, energy, eaten }: { plan: Plan; targets: NutritionTarget[]; energy: EnergyDisplay; /** What was actually eaten (#97). */ eaten?: { main: string; note: string } | null }) {
  const { colors, type } = useTheme();

  const text = targets.map((t) => formatTarget(plan, t, energy)).join('  ·  ');
  const w = plan.nutrition.eatingWindow;
  if (!targets.length && !w && !eaten) return null;
  return (
    <View style={styles.wrap} testID="targets">
      {targets.length > 0 && (
        <Text style={type.detail} accessibilityLabel={speakEnergy(text)}>
          {text}
        </Text>
      )}
      {w && <Text style={type.detail}>Eating {formatClock(w.start)}–{formatClock(w.end)}</Text>}
      {eaten && (
        <View style={styles.eaten} testID="eaten">
          <Text style={[type.detail, { color: colors.ink }]} accessibilityLabel={speakEnergy(eaten.main)}>{eaten.main}</Text>
          <Text style={type.detail}>{eaten.note}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { marginTop: space.md, gap: 2 }, eaten: { marginTop: space.xs, gap: 2 } });
