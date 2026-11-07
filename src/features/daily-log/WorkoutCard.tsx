import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ChecklistRow, SessionProgress, Variant } from '../../prescription/exercises';
import type { PrescriptionItem } from '../../prescription/prescribe';
import type { PrescribedExercise } from '../../prescription/session';
import { radius, space, touch, createThemedStyles } from '../../ui/theme';
import { ExerciseChecklist, VersionSwitch } from './ExerciseChecklist';

type Props = {
  item: PrescriptionItem;
  progress: SessionProgress;
  /** Collapsed (default): workout, progress and the next exercise only. Expanded: the whole checklist. */
  expanded: boolean;
  onToggleExpanded: () => void;
  onTick: (row: ChecklistRow) => void;
  onChooseVariant: (v: Variant) => void;
  onOpenExercise: (e: PrescribedExercise) => void;
  onDetails: () => void;
  onCoverage?: () => void;
  /** Just finished: hold "complete · 5/5" briefly before "Do this next" moves on. */
  completed?: boolean;
  onDismissCompleted?: () => void;
};

/**
 * "Do this next" for a session (#28, option C): a live checklist that stays a compact summary.
 * Collapsed is deliberately minimal (identity + progress + next exercise): don't add controls or copy to it.
 */
export function WorkoutCard(p: Props) {
  const styles = useStyles();

  const { item, progress } = p;
  const s = item.session!;
  const summary = [progress.variant === 'short' ? 'Short' : null, progress.minutes ? `${progress.minutes} min` : null, `${progress.done} of ${progress.total} exercises`]
    .filter(Boolean)
    .join(' · ');

  // A quiet cue that the next exercise changed: fade it in, no movement.
  const fade = useRef(new Animated.Value(1)).current;
  const nextKey = progress.next?.key ?? null;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    fade.setValue(0.25);
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: false }).start();
    // Never leave the row dim if the animation clock stalls (e.g. a frozen clock in tests).
    const settle = setTimeout(() => fade.setValue(1), 300);
    return () => clearTimeout(settle);
  }, [nextKey, fade]);

  if (p.completed) {
    return (
      <View style={styles.card} testID="next-action" accessibilityLiveRegion="polite">
        <View style={styles.headRow}>
          <View style={styles.flex}>
            <Text style={styles.eyebrow}>Done</Text>
            <Text style={styles.title} accessibilityRole="header" testID="next-action-title">
              {item.label} complete
            </Text>
            <Text style={styles.sub} testID="workout-summary">
              {progress.done} of {progress.total} exercises ✓
            </Text>
          </View>
        </View>
        <Pressable onPress={p.onDismissCompleted} style={styles.link} accessibilityRole="button" accessibilityLabel="Show what's next">
          <Text style={styles.linkText}>What's next ›</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card} testID="next-action" accessibilityLiveRegion="polite">
      <View style={styles.headRow}>
        <Pressable onPress={p.onToggleExpanded} style={styles.flex} accessibilityRole="button" accessibilityLabel={`${item.label}, ${summary}. ${p.expanded ? 'Hide' : 'Show'} all exercises`}>
          <Text style={styles.eyebrow}>Do this next</Text>
          <Text style={styles.title} accessibilityRole="header" testID="next-action-title">
            {item.label}
          </Text>
          <Text style={styles.sub} testID="workout-summary">
            {summary}
          </Text>
        </Pressable>
        <Pressable
          onPress={p.onToggleExpanded}
          style={styles.expand}
          accessibilityRole="button"
          accessibilityLabel={p.expanded ? 'Hide exercises' : 'Show all exercises'}
          aria-expanded={p.expanded}
          testID="workout-expand"
        >
          <Text style={styles.expandText}>{p.expanded ? '⌃' : '⌄'}</Text>
        </Pressable>
      </View>

      {p.expanded ? (
        <>
          {progress.hasShort && (
            <VersionSwitch progress={progress} fullMinutes={s.minutes} shortMinutes={s.short?.minutes} editable onChoose={p.onChooseVariant} onInk />
          )}
          <ExerciseChecklist
            rows={progress.rows}
            nextKey={nextKey}
            editable
            onToggle={p.onTick}
            onOpen={p.onOpenExercise}
            testID="next-action-session"
          />
          <Pressable onPress={p.onDetails} style={styles.link} accessibilityRole="button" accessibilityLabel={`${item.label} options`}>
            <Text style={styles.linkText}>Skip and more</Text>
          </Pressable>
          {p.onCoverage && <Pressable onPress={p.onCoverage} style={styles.link} accessibilityRole="button" accessibilityLabel="Muscle coverage and log exercise"><Text style={styles.linkText}>Muscle coverage & log exercise ›</Text></Pressable>}
        </>
      ) : progress.next ? (
        <Animated.View style={{ opacity: fade }}>
          <ExerciseChecklist rows={[progress.next]} editable onToggle={p.onTick} onOpen={p.onOpenExercise} labelNext testID="next-action-session" />
        </Animated.View>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, paddingBottom: space.md, gap: space.sm },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  flex: { flex: 1 },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.onInkAction },
  title: { fontSize: 22, fontWeight: '800', color: colors.onCard },
  sub: { ...type.detail, color: colors.onInkMuted, ...type.number },
  expand: { width: touch, height: touch, borderRadius: touch / 2, borderWidth: 1, borderColor: colors.inkRaised, alignItems: 'center', justifyContent: 'center', marginRight: -space.xs },
  expandText: { color: colors.onCard, fontSize: 18, fontWeight: '700' },
  link: { minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: colors.onInkMuted, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
}));
