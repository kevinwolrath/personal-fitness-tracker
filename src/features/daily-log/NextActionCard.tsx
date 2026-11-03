import type { EnergyDisplay } from '../../energy';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock } from '../../format';
import { mealView } from '../../plan/meals';
import type { Activity, Plan } from '../../plan/schema';
import type { NextAction } from '../../prescription/nextAction';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { partLabels } from '../../prescription/windows';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { MealDetails } from './MealDetails';

type Props = {
  /** The active plan: a meal's ingredients and amounts come from it (#26). */
  plan: Plan;
  next: NextAction | null;
  progress: { done: number; total: number };
  logs: Record<string, ActivityLog | undefined>;
  onAdvance: (item: PrescriptionItem, a: Activity) => void;
  onDetails: (item: PrescriptionItem) => void;
  /** How energy is shown (#39). */
  energy: EnergyDisplay;
};

function whenLabel(n: NextAction): string {
  const w = n.item.window;
  const at = w.time ? formatClock(w.time) : partLabels[w.part];
  if (n.status === 'now') return w.time ? `Now · ${at}` : `Now · ${at.toLowerCase()}`;
  if (n.status === 'anytime') return 'Anytime today';
  if (n.status === 'overdue') return w.time ? `Was due ${at}` : `Was due this ${at.toLowerCase()}`;
  return w.time ? `Next up at ${at}` : `Later · ${at.toLowerCase()}`;
}

function primaryTitle(a: Activity, log: ActivityLog | undefined): string {
  if (a.tracking.type === 'count') {
    const c = log?.count ?? 0;
    return `Add ${a.tracking.unitLabel.replace(/s$/, '')} · ${c + 1} of ${a.tracking.target}`;
  }
  return 'Done';
}

/** "What am I supposed to be doing now?" — the single most useful action, ready to tick off (contract 08). */
/** Sessions (strength workouts) use WorkoutCard instead: an exercise checklist with no whole-workout Done (#28). */
export function NextActionCard({ plan, next, progress, logs, onAdvance, onDetails, energy }: Props) {
  if (!next) {
    return (
      <View style={styles.card} testID="next-action" accessibilityLiveRegion="polite">
        <Text style={styles.eyebrow}>Today</Text>
        <Text style={styles.title}>{progress.total ? 'Nothing left for today' : 'Nothing planned for today'}</Text>
        {progress.total > 0 && <Text style={styles.sub}>{`All ${progress.total} done or skipped`}</Text>}
      </View>
    );
  }
  const { item } = next;
  // A meal that's next shows what to eat right here: no extra tap (#26).
  const meal = item.activity ? mealView(plan, item.activity, energy) : null;
  return (
    <View style={styles.card} testID="next-action" accessibilityLiveRegion="polite">
      <Text style={styles.eyebrow}>Do this next</Text>
      <Text style={styles.title} accessibilityRole="header" testID="next-action-title">
        {item.label}
      </Text>
      <Text style={styles.sub} testID="next-action-when">
        {[whenLabel(next), item.detail].filter(Boolean).join(' · ')}
      </Text>
      {meal && (
        <View style={styles.meal}>
          <MealDetails meal={meal} variant="card" testID="next-action-meal" />
        </View>
      )}
      <View style={styles.actions}>
        {item.kind === 'activity' && item.activity ? (
          <Button variant="inverse" title={primaryTitle(item.activity, logs[item.activity.id])} onPress={() => onAdvance(item, item.activity!)} accessibilityLabel={`Done: ${item.label}`} />
        ) : (
          item.options.map((o) => (
            <Button
              variant="inverse"
              key={o.id}
              title={o.tracking.type === 'count' ? `${o.label} · ${primaryTitle(o, logs[o.id]).replace(/^Add /, '+1 ')}` : o.label}
              onPress={() => onAdvance(item, o)}
              accessibilityLabel={`Do ${o.label}`}
            />
          ))
        )}
        <Pressable onPress={() => onDetails(item)} style={styles.details} accessibilityRole="button" accessibilityLabel={`${item.label} options`}>
          <Text style={styles.detailsText}>Skip and more</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.onInkAction },
  title: { fontSize: 24, fontWeight: '800', color: colors.onAccent },
  sub: { ...type.detail, color: colors.onInkMuted },
  meal: { marginTop: space.sm },
  actions: { gap: space.sm, marginTop: space.md },
  details: { minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  detailsText: { color: colors.onInkMuted, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
