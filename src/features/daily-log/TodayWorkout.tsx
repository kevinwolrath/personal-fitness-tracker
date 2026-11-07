import { Pressable, Text, View } from 'react-native';
import { ScrollView } from '../../ui/ScrollView';
import type { MuscleCoverage } from '../../exercises/coverage';
import type { RowStatus, TodayWorkout, WorkoutRow } from '../../exercises/todayWorkout';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';
import { MuscleMap } from '../muscles/MuscleMap';

/**
 * Today's workout (#56, layout A). The collapsed card (content layer, ≤ 200 px): counts, the next exercise with its
 * tick, and "Show all". The sheet: coverage preview, counts, every eligible exercise (to do by priority, then done).
 * Presentation only: the list, order, counts and what a tick writes come from `todayWorkout()`.
 */

/** Status text with a symbol, so it never depends on colour alone. */
export const statusText: Record<RowStatus, string> = {
  due: '! Due',
  building: '◐ Building',
  trained: '✓ Trained',
  recovering: '↻ Recovering',
  sore: '≋ Sore',
  injured: '✕ Injured',
};

function Row({ row, editable, onToggle, onGuide, onCard }: { row: WorkoutRow; editable: boolean; onToggle: (r: WorkoutRow) => void; onGuide: (r: WorkoutRow) => void; onCard?: boolean }) {
  const styles = useStyles();
  const ink = onCard ? styles.onCard : styles.onSurface;
  const muted = onCard ? styles.onCardMuted : styles.onSurfaceMuted;
  return (
    <View style={styles.row} testID={`workout-row-${row.movement}`}>
      <Pressable
        onPress={() => onToggle(row)}
        disabled={!editable}
        style={({ pressed }) => [styles.circle, pressed && styles.pressed]}
        role="checkbox"
        aria-checked={row.done}
        aria-disabled={!editable}
        aria-label={`${row.name}, ${row.doseLabel}`}
        testID={`workout-tick-${row.movement}`}
      >
        <View style={[styles.mark, row.done && styles.markDone]}>{row.done ? <Text style={styles.tick}>✓</Text> : null}</View>
      </Pressable>
      <View style={styles.body}>
        <View style={[styles.nameLine, onCard && styles.noWrap]}>
          {/* One line on the card, so it stays within its 200 px budget; the sheet shows names in full. */}
          <Text style={[styles.name, ink, row.done && styles.struck, onCard && styles.shrink]} numberOfLines={onCard ? 1 : undefined}>{row.name}</Text>
          {row.plan ? <Text style={[styles.badge, ink]}>Plan</Text> : null}
        </View>
        <View style={styles.nameLine}>
          {row.status && !row.done ? <Text style={[styles.chip, ink]} testID={`workout-status-${row.movement}`}>{statusText[row.status]}</Text> : null}
          {row.caution ? <Text style={[styles.chip, ink]}>Caution</Text> : null}
          {row.prescribed?.substitutedFor ? <Text style={[styles.muscles, muted]}>instead of {row.prescribed.substitutedFor.toLowerCase()}</Text> : null}
          <Text style={[styles.muscles, muted, row.done && styles.struck]} numberOfLines={1}>{row.muscles.join(' · ')}</Text>
        </View>
      </View>
      <Text style={[styles.dose, muted]}>{row.doseLabel}</Text>
      <Pressable onPress={() => onGuide(row)} style={styles.info} accessibilityRole="button" accessibilityLabel={`${row.name}. Show how`} testID={`workout-guide-${row.movement}`}>
        <Text style={[styles.infoText, ink]}>ⓘ</Text>
      </Pressable>
    </View>
  );
}

/** Rest day, else the day's session and its state (planned, done or skipped), else optional. */
const subtitle = (w: TodayWorkout) => {
  if (w.restDay) return 'Rest day · optional';
  const s = w.sessions[0];
  if (!s) return 'Optional · any time today';
  return `${s.label} · ${s.state === 'skipped' ? 'skipped' : s.state === 'done' ? 'done ✓' : 'plan and more'}`;
};

export function TodayWorkoutCard({ workout, promoted, editable, onToggle, onGuide, onOpen, loading = false }: {
  workout: TodayWorkout;
  /** Today's priority order is still loading: keep the card's height, but don't show an exercise that may change. */
  loading?: boolean;
  /** The strength session is "Do this next" (#41): the card sits in the top slot. */
  promoted: boolean;
  editable: boolean;
  onToggle: (r: WorkoutRow) => void;
  onGuide: (r: WorkoutRow) => void;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const w = workout;
  const counts = w.remaining ? `${w.done} of ${w.total} done · ${w.remaining} left` : `All ${w.total} done`;
  return (
    <View style={styles.card} testID="today-workout" accessibilityLiveRegion="polite">
      <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Today's workout: ${counts}. ${subtitle(w)}. Show all exercises`} testID="today-workout-open">
        <Text style={styles.eyebrow}>{promoted ? "Do this next · Today's workout" : "Today's workout"}</Text>
        <Text style={styles.title} accessibilityRole="header" testID="today-workout-counts">{counts}</Text>
        <Text style={[styles.sub, styles.onCardMuted]} testID="today-workout-subtitle">{subtitle(w)}</Text>
      </Pressable>
      {loading ? (
        <View style={styles.placeholder} testID="today-workout-loading" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      ) : w.next ? (
        <Row row={w.next} editable={editable} onToggle={onToggle} onGuide={onGuide} onCard />
      ) : null}
      <Pressable onPress={onOpen} style={styles.link} accessibilityRole="button" accessibilityLabel={`Show all ${w.total} exercises`} testID="today-workout-show-all">
        <Text style={styles.linkText}>{`Show all ${w.total} ⌄`}</Text>
      </Pressable>
    </View>
  );
}

export function TodayWorkoutSheet({ workout, coverage, gender, editable, onToggle, onGuide, onCoverage, onLogDifferent, onSessionOptions, onClose, loading = false }: {
  workout: TodayWorkout;
  loading?: boolean;
  coverage: MuscleCoverage[] | null;
  gender?: unknown;
  editable: boolean;
  onToggle: (r: WorkoutRow) => void;
  onGuide: (r: WorkoutRow) => void;
  onCoverage: () => void;
  onLogDifferent: () => void;
  onSessionOptions: (session: PrescriptionItem) => void;
  onClose: () => void;
}) {
  const styles = useStyles();
  const { type } = useTheme();
  const w = workout;
  const todo = w.rows.filter((r) => !r.done);
  const done = w.rows.filter((r) => r.done);
  return (
    <Sheet visible onClose={onClose} label="Today's workout" fill>
      <ModalHeader title="Today's workout" dismiss={{ label: 'Close', a11yLabel: "Close today's workout", onPress: onClose }} />
      <ScrollView style={styles.flex} contentContainerStyle={styles.sheet} testID="today-workout-sheet">
        <Pressable onPress={onCoverage} style={styles.preview} accessibilityRole="button" accessibilityLabel="Muscle coverage. Open the full view" testID="today-workout-coverage">
          <View style={styles.previewMap}>
            <MuscleMap gender={gender} coverage={coverage ?? []} mode="priority" compact />
          </View>
          <Text style={[type.detail, styles.previewText]}>{w.restDay ? 'Rest day: nothing is due. Muscle coverage ›' : 'Muscle coverage ›'}</Text>
        </Pressable>
        <View style={styles.counts} testID="today-workout-totals">
          {([['total', w.total], ['remaining', w.remaining], ['done', w.done]] as const).map(([k, n]) => (
            <View key={k} style={styles.count} accessible accessibilityLabel={`${n} ${k}`}>
              <Text style={[styles.countN, styles.onSurface]}>{n}</Text>
              <Text style={type.detail}>{k}</Text>
            </View>
          ))}
        </View>
        {todo.length > 0 && <Text style={type.section} accessibilityRole="header">{w.restDay ? 'To do · optional' : 'To do · by priority'}</Text>}
        {loading ? <Text style={type.detail} testID="today-workout-loading">Loading today's order…</Text> : null}
        <View testID="today-workout-todo">{loading ? null : todo.map((r) => <Row key={r.movement} row={r} editable={editable} onToggle={onToggle} onGuide={onGuide} />)}</View>
        {done.length > 0 && <Text style={type.section} accessibilityRole="header">{`Done · ${done.length}`}</Text>}
        <View testID="today-workout-done">{done.map((r) => <Row key={r.movement} row={r} editable={editable} onToggle={onToggle} onGuide={onGuide} />)}</View>
        <Button title="Log with a different dose…" variant="secondary" disabled={!editable} onPress={onLogDifferent} />
        {w.sessions.map((s) => (
          <Button key={s.key} title={`${s.label}: full or short, skip and more`} variant="quiet" onPress={() => onSessionOptions(s)} />
        ))}
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  flex: { flex: 1 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, paddingBottom: space.xs, gap: space.xs },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.onInkAction },
  title: { fontSize: 22, fontWeight: '800', color: colors.onCard, ...type.number },
  sub: { ...type.detail },
  link: { minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  placeholder: { minHeight: touch + space.sm + space.xs * 2 },
  linkText: { color: colors.onCardMuted, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  sheet: { gap: space.md, paddingBottom: space.xl },
  preview: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch, padding: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  previewMap: { width: 120 },
  previewText: { flex: 1 },
  counts: { flexDirection: 'row', gap: space.sm },
  count: { flex: 1, alignItems: 'center', paddingVertical: space.sm, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line },
  countN: { fontSize: 22, fontWeight: '800', ...type.number },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: touch + space.sm, borderBottomWidth: 1, borderColor: colors.line, paddingVertical: space.xs },
  circle: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontWeight: '800', fontSize: 15 },
  pressed: { opacity: 0.6 },
  body: { flex: 1, gap: 2 },
  nameLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space.xs },
  name: { fontSize: 16, fontWeight: '700' },
  struck: { textDecorationLine: 'line-through', opacity: 0.7 },
  shrink: { flexShrink: 1 },
  noWrap: { flexWrap: 'nowrap' },
  badge: { flexShrink: 0, fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  chip: { fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.priority, overflow: 'hidden' },
  muscles: { fontSize: 13, flexShrink: 1 },
  dose: { fontSize: 14, fontWeight: '600', ...type.number },
  info: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  infoText: { fontSize: 20 },
  onCard: { color: colors.onCard },
  onCardMuted: { color: colors.onCardMuted },
  onSurface: { color: colors.ink },
  onSurfaceMuted: { color: colors.muted },
}));
