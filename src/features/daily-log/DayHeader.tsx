import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import type { LocalDate } from '../../plan/dates';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
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
  /** "Share this day" (#76). Absent: no Share (future dates). */
  onShare?: () => void;
};

/** Widths for the Share button in the date row (#76): with its label, or the 48 dp icon alone. */
const SHARE_LABEL_WIDTH = 100;
const SHARE_ICON_WIDTH = 52;

/**
 * Header for any date in the Daily Log: step by day, jump to a date, return to Today.
 * The date and title never truncate; they're the answer to "where am I in the log?".
 */
export function DayHeader(p: Props) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const labels = dayLabels(p.date, p.today);
  const pct = p.progress.total ? p.progress.done / p.progress.total : 0;

  // Share sits at the right of the date row (#76, option A). It shows its label where there's room (today), the
  // icon alone where only that fits (other dates beside "Today"), and only on the narrowest phones, where even the
  // icon would crowd the date (which must never truncate), it moves to the start of the title row.
  const [w, setW] = useState({ row: 0, date: 0, today: 0 });
  const measure = (k: keyof typeof w) => (e: LayoutChangeEvent) => {
    const v = Math.round(e.nativeEvent.layout.width);
    setW((o) => (o[k] === v ? o : { ...o, [k]: v }));
  };
  const showsToday = labels.when !== 'today';
  const free = w.row - 2 * touch - w.date - (showsToday ? w.today : 0);
  const shareMode: 'label' | 'icon' | 'title' | null = !p.onShare || !w.row || !w.date ? null : free >= SHARE_LABEL_WIDTH ? 'label' : free >= SHARE_ICON_WIDTH ? 'icon' : 'title';
  const share = (iconOnly: boolean) => (
    <Pressable
      onPress={p.onShare}
      style={[styles.share, iconOnly && styles.shareIcon]}
      accessibilityRole="button"
      accessibilityLabel="Share this day"
      testID="share-day"
    >
      <Text style={styles.shareText}>{iconOnly ? '⤴' : '⤴ Share'}</Text>
    </Pressable>
  );
  return (
    <View>
      <View style={styles.nav} onLayout={measure('row')}>
        <Pressable onPress={p.onPrev} style={styles.chevron} accessibilityRole="button" accessibilityLabel="Previous day" hitSlop={4}>
          <Text style={styles.chevronText}>‹</Text>
        </Pressable>
        <Pressable
          onPress={p.onPickDate}
          style={styles.dateButton}
          onLayout={measure('date')}
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
        {(shareMode === 'label' || shareMode === 'icon') && share(shareMode === 'icon')}
        {showsToday && (
          <Pressable onPress={p.onToday} onLayout={measure('today')} style={styles.todayButton} accessibilityRole="button" accessibilityLabel="Back to Today">
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        )}
      </View>

      <View style={styles.titleRow}>
        {shareMode === 'title' && share(true)}
        <Text style={styles.title} accessibilityRole="header" testID="day-title">
          {labels.title}
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
      <View style={styles.progressRow}>
        <Text style={[type.detail, styles.progressText]} testID="day-progress">
          {p.progress.total === 0 ? 'Nothing required' : p.progress.complete ? `All ${p.progress.total} done` : `${p.progress.done} of ${p.progress.total} done`}
        </Text>
        <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={[styles.fill, { width: `${pct * 100}%` }]} />
        </View>
      </View>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
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
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayText: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  share: {
    minHeight: touch,
    paddingHorizontal: space.md,
    marginRight: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareIcon: { width: touch, paddingHorizontal: 0 },
  shareText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  // When a long date title and the chip don't fit on one line, the chip wraps below (right-aligned); neither truncates.
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.md, rowGap: space.xs },
  title: { ...type.title, fontSize: 26, flexShrink: 0 },
  chip: {
    minHeight: touch,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
    marginLeft: 'auto',
    flexShrink: 1,
  },
  chipOverridden: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  progressText: { ...type.number },
  track: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, backgroundColor: colors.accent },
}));
