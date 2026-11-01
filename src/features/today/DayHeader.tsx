import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatShortDate, formatWeekday } from '../../format';
import type { LocalDate } from '../../plan/dates';
import { colors, radius, space, touch, type } from '../../ui/theme';

type Props = {
  date: LocalDate;
  today: LocalDate;
  yesterday: LocalDate;
  dayTypeLabel: string;
  overridden: boolean;
  progress: { done: number; total: number; complete: boolean };
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onDayType: () => void;
};

export function DayHeader(p: Props) {
  const title = p.date === p.today ? 'Today' : p.date === p.yesterday ? 'Yesterday' : formatWeekday(p.date);
  const pct = p.progress.total ? p.progress.done / p.progress.total : 0;
  return (
    <View>
      <View style={styles.nav}>
        <Pressable onPress={p.onPrev} style={styles.chevron} accessibilityRole="button" accessibilityLabel="Previous day" hitSlop={4}>
          <Text style={styles.chevronText}>‹</Text>
        </Pressable>
        <Pressable
          onPress={p.onToday}
          disabled={p.date === p.today}
          style={styles.dateButton}
          accessibilityRole="button"
          accessibilityLabel={p.date === p.today ? formatShortDate(p.date) : `${formatShortDate(p.date)}, go to today`}
        >
          <Text style={styles.date}>{formatShortDate(p.date)}</Text>
        </Pressable>
        <Pressable onPress={p.onNext} style={styles.chevron} accessibilityRole="button" accessibilityLabel="Next day" hitSlop={4}>
          <Text style={styles.chevronText}>›</Text>
        </Pressable>
        <View style={styles.spacer} />
        <Pressable
          onPress={p.onDayType}
          style={[styles.chip, p.overridden && styles.chipOverridden]}
          accessibilityRole="button"
          accessibilityLabel={`Day type: ${p.dayTypeLabel}. Change`}
        >
          <Text style={styles.chipText}>{p.dayTypeLabel} ▾</Text>
        </Pressable>
      </View>

      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[type.detail, styles.progressText]} testID="day-progress">
        {p.progress.total === 0 ? 'Nothing required today' : p.progress.complete ? `All ${p.progress.total} done` : `${p.progress.done} of ${p.progress.total} done`}
      </Text>
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
  chip: {
    minHeight: touch,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipOverridden: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  title: { ...type.title, marginTop: space.sm },
  progressText: { marginTop: space.xs, ...type.number },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, marginTop: space.sm, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
});
