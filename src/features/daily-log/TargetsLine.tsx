import { StyleSheet, Text, View } from 'react-native';
import { speakEnergy, type EnergyDisplay } from '../../energy';
import { formatClock, formatTarget } from '../../format';
import type { NutritionTarget, Plan } from '../../plan/schema';
import { space, useTheme } from '../../ui/theme';

/** Daily nutrition targets + eating window as quiet text (display only). */
export function TargetsLine({ plan, targets, energy }: { plan: Plan; targets: NutritionTarget[]; energy: EnergyDisplay }) {
  const { colors, type } = useTheme();

  const text = targets.map((t) => formatTarget(plan, t, energy)).join('  ·  ');
  const w = plan.nutrition.eatingWindow;
  if (!targets.length && !w) return null;
  return (
    <View style={styles.wrap} testID="targets">
      {targets.length > 0 && (
        <Text style={type.detail} accessibilityLabel={speakEnergy(text)}>
          {text}
        </Text>
      )}
      {w && <Text style={type.detail}>Eating {formatClock(w.start)}–{formatClock(w.end)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { marginTop: space.md, gap: 2 } });
