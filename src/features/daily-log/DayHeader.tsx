import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalDate } from '../../plan/dates';
import { colors, radius, space, touch, type } from '../../ui/theme';
import { dayLabels } from './dayLabels';

type Props = {
  date: LocalDate;
  today: LocalDate;
  dayTypeLabel: string;
  overridden: boolean;
  progress: { done: number; total: number; complete: boolean };
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onPickDate: () => void;
  onDayType: () => void;
  /** Opens the app menu (import, configure, export). */
  onMenu: () => void;
};

/**
 * Header for any date in the Daily Log: step by day, jump to a date, return to Today.
 * The date and title never truncate; they're the answer to "where am I in the log?".
 */
export function DayHeader(p: Props) {
  const labels = dayLabels(p.date, p.today);
  const pct = p.progress.total ? p.progress.done / p.progress.total : 0;
  return (
    <View>
      <View style={styles.nav}>
        <Pressable onPress={p.onPrev} style={styles.chevron} accessibilityRole="button" accessibilityLabel="Previous day" hitSlop={4}>
          <Text style={styles.chevronText}>‹</Text>
        </Pressable>
        <Pressable
          onPress={p.onPickDate}
          style={styles.dateButton}
          accessibilityRole="button"
          accessibilityLabel={`${labels.date}. Jump to a date`}
          testID="date-button"
        >
          <Text style={styles.date}>{labels.date} ▾</Text>
        </Pressable>
        <Pressable onPress={p.onNext} style={styles.chevron} accessibilityRole="button" accessibilityLabel="Next day" hitSlop={4}>
          <Text style={styles.chevronText}>›</Text>
        </Pressable>
        <View style={styles.spacer} />
        {labels.when !== 'today' && (
          <Pressable onPress={p.onToday} style={styles.todayButton} accessibilityRole="button" accessibilityLabel="Back to Today">
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.titleRow}>
        <Text style={styles.title} accessibilityRole="header" testID="day-title">
          {labels.title}
        </Text>
        <Pressable onPress={p.onMenu} style={styles.menuButton} accessibilityRole="button" accessibilityLabel="Menu" testID="menu-button" hitSlop={4}>
          <View style={styles.burger}>
            <View style={styles.bar} />
            <View style={styles.bar} />
            <View style={styles.bar} />
          </View>
        </Pressable>
      </View>
      <View style={styles.statusRow}>
        <Text style={[type.detail, styles.progressText]} testID="day-progress">
          {p.progress.total === 0 ? 'Nothing required' : p.progress.complete ? `All ${p.progress.total} done` : `${p.progress.done} of ${p.progress.total} done`}
        </Text>
        <Pressable
          onPress={p.onDayType}
          style={[styles.chip, p.overridden && styles.chipOverridden]}
          accessibilityRole="button"
          accessibilityLabel={`Day type: ${p.dayTypeLabel}. Change`}
        >
          <Text style={styles.chipText} numberOfLines={1}>
            {p.dayTypeLabel} ▾
          </Text>
        </Pressable>
      </View>
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${pct * 100}%` }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', marginLeft: -space.md },
  chevron: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center' },
  chevronText: { fontSize: 28, color: colors.ink, lineHeight: 30 },
  dateButton: { minHeight: touch, justifyContent: 'center', paddingHorizontal: space.xs },
  date: { ...type.body, fontSize: 16 },
  spacer: { flex: 1 },
  todayButton: {
    minHeight: touch,
    minWidth: touch,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
  title: { ...type.title, flex: 1 },
  menuButton: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center', marginRight: -space.sm },
  burger: { width: 22, gap: 5 },
  bar: { height: 2.5, borderRadius: 2, backgroundColor: colors.ink },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  progressText: { flex: 1, ...type.number },
  chip: {
    minHeight: touch,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    flexShrink: 1,
  },
  chipOverridden: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: space.sm, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
});
