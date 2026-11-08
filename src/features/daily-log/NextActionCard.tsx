import type { EnergyDisplay } from '../../energy';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock, formatCountdown } from '../../format';
import { mealView } from '../../plan/meals';
import type { Activity, Plan } from '../../plan/schema';
import type { NextAction } from '../../prescription/nextAction';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { partLabels } from '../../prescription/windows';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { MealDetails } from './MealDetails';

type Props = {
  /** The active plan: a meal's ingredients and amounts come from it (#26). */
  plan: Plan;
  /** Never null: with no useful recommendation the screen shows no card at all (#41). */
  next: NextAction;
  /** Local minutes since midnight: for the countdown to an upcoming item and "in 15 min" once it's due (#51). */
  nowMinutes: number;
  logs: Record<string, ActivityLog | undefined>;
  onAdvance: (item: PrescriptionItem, a: Activity) => void;
  onDetails: (item: PrescriptionItem) => void;
  /** How energy is shown (#39). */
  energy: EnergyDisplay;
  /** A meal that's due: log what was actually eaten instead (#97). */
  onLogDifferent?: (item: PrescriptionItem) => void;
};

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function whenLabel(n: NextAction, nowMinutes: number): string {
  const w = n.item.window;
  const at = w.time ? formatClock(w.time) : partLabels[w.part];
  // Due but not yet at its time (inside the lead window): say how soon (#51).
  if (n.status === 'now' && w.time && nowMinutes < w.at) return `${sentence(formatCountdown(w.at - nowMinutes))} · ${at}`;
  return w.time ? `Now · ${at}` : `Now · ${at.toLowerCase()}`;
}

function primaryTitle(a: Activity, log: ActivityLog | undefined): string {
  if (a.tracking.type === 'count') {
    const c = log?.count ?? 0;
    return `Add ${a.tracking.unitLabel.replace(/s$/, '')} · ${c + 1} of ${a.tracking.target}`;
  }
  return 'Done';
}

/**
 * "What am I supposed to be doing now?" — the single most useful action, ready to tick off (contract 08).
 * When nothing is due it shrinks to a compact "Up next" preview with a countdown and Details (#51),
 * only for a timed item due within the hour (#41). The screen hides the card when there's nothing to recommend.
 */
/** Sessions (strength workouts) use WorkoutCard instead: an exercise checklist with no whole-workout Done (#28). */
export function NextActionCard({ plan, next, nowMinutes, logs, onAdvance, onDetails, energy, onLogDifferent }: Props) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { item } = next;
  // Nothing is due yet (#51): a compact preview only. No meal, no Done; early completion or skipping is in Details.
  if (next.status === 'later') {
    const w = item.window;
    const at = w.time ? formatClock(w.time) : partLabels[w.part].toLowerCase();
    return (
      <View style={[styles.card, styles.compact]} testID="up-next" accessibilityLiveRegion="polite">
        <View style={styles.compactText}>
          <Text style={styles.eyebrow} testID="up-next-when">{`Up next · ${at}`}</Text>
          <Text style={styles.compactTitle} accessibilityRole="header" testID="up-next-title" numberOfLines={2}>
            {item.label}
          </Text>
          <Text style={styles.sub} numberOfLines={1} testID="up-next-countdown">
            {[sentence(formatCountdown(w.at - nowMinutes)), item.detail].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <Pressable
          onPress={() => onDetails(item)}
          style={({ pressed }) => [styles.compactDetails, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={`Up next details: ${item.label}`}
          testID="up-next-details"
        >
          <Text style={styles.compactDetailsText}>Details</Text>
        </Pressable>
      </View>
    );
  }
  // A meal that's next shows what to eat right here: no extra tap (#26).
  const meal = item.activity ? mealView(plan, item.activity, energy) : null;
  return (
    <View style={styles.card} testID="next-action" accessibilityLiveRegion="polite">
      <Text style={styles.eyebrow}>Do this next</Text>
      <Text style={styles.title} accessibilityRole="header" testID="next-action-title">
        {item.label}
      </Text>
      <Text style={styles.sub} testID="next-action-when">
        {[whenLabel(next, nowMinutes), item.detail].filter(Boolean).join(' · ')}
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
        {item.activity?.kind === 'meal' && onLogDifferent && (
          // Secondary, outlined, under Done (#97 entry A): Done stays the card's one primary action.
          <Button variant="secondary" title="📷 Log different meal" onPress={() => onLogDifferent(item)} accessibilityLabel={`Log a different meal instead of ${item.label}`} testID="next-action-log-different" />
        )}
        <Pressable onPress={() => onDetails(item)} style={styles.details} accessibilityRole="button" accessibilityLabel={`${item.label} options`}>
          <Text style={styles.detailsText}>Skip and more</Text>
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.onInkAction },
  title: { fontSize: 24, fontWeight: '800', color: colors.onCard },
  sub: { ...type.detail, color: colors.onInkMuted },
  meal: { marginTop: space.sm },
  actions: { gap: space.sm, marginTop: space.md },
  compact: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  compactText: { flex: 1, gap: 2 },
  compactTitle: { fontSize: 19, fontWeight: '800', color: colors.onCard },
  compactDetails: { minHeight: touch, paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1, borderColor: colors.inkRaised, alignItems: 'center', justifyContent: 'center' },
  compactDetailsText: { color: colors.onCard, fontSize: 15, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  details: { minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  detailsText: { color: colors.onInkMuted, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
}));
