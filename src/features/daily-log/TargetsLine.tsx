import { StyleSheet, Text, View } from 'react-native';
import { formatClock, formatTarget } from '../../format';
import type { NutritionTarget, Plan } from '../../plan/schema';
import { space, type } from '../../ui/theme';

/** Daily nutrition targets + eating window as quiet text (display only). */
export function TargetsLine({ plan, targets }: { plan: Plan; targets: NutritionTarget[] }) {
  const w = plan.nutrition.eatingWindow;
  if (!targets.length && !w) return null;
  return (
    <View style={styles.wrap} testID="targets">
      {targets.length > 0 && <Text style={type.detail}>{targets.map((t) => formatTarget(plan, t)).join('  ·  ')}</Text>}
      {w && <Text style={type.detail}>Eating {formatClock(w.start)}–{formatClock(w.end)}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { marginTop: space.md, gap: 2 } });
