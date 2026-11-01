import { Pressable, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { formatClock, formatDuration } from '../../format';
import type { Activity } from '../../plan/schema';
import type { ActivityLog } from '../../storage/types';
import { colors, space, touch, type } from '../../ui/theme';

type Props = {
  activity: Activity;
  log: ActivityLog | undefined;
  showTime: boolean;
  /** Extra meta, e.g. the flexible-meal budget. */
  note?: string | null;
  editable: boolean;
  /** This is the "do this next" item (contract 08). */
  isNext?: boolean;
  onPress: () => void;
  onMore: () => void;
  onSkipToggle: () => void;
};

export function ActivityRow({ activity: a, log, showTime, note, editable, isNext, onPress, onMore, onSkipToggle }: Props) {
  const status = log?.status ?? 'pending';
  const done = status === 'done';
  const skipped = status === 'skipped';
  const count = log?.count ?? 0;
  const isCount = a.tracking.type === 'count';
  const target = a.tracking.type === 'count' ? a.tracking.target : 1;

  const sessionMeta = a.session ? `${a.session.minutes ? `${a.session.minutes} min · ` : ''}${a.session.exercises.length} exercises` : null;
  const variantMeta = done && log?.variant === 'short' ? 'Short version' : null;
  const meta = [a.detail, sessionMeta ?? formatDuration(a.duration), !a.required ? 'Optional' : null, skipped ? 'Skipped' : null, variantMeta, note]
    .filter(Boolean)
    .join(' · ');
  const time = showTime && a.time ? formatClock(a.time) : null;
  const a11yState = isCount ? `${count} of ${target} ${a.tracking.type === 'count' ? a.tracking.unitLabel : ''}` : undefined;

  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'activate') onPress();
    if (e.nativeEvent.actionName === 'skip') onSkipToggle();
    if (e.nativeEvent.actionName === 'details') onMore();
  };

  return (
    <View style={[styles.row, isNext && styles.next]} testID={`activity-${a.id}`}>
      <Pressable
        onPress={onPress}
        onLongPress={onMore}
        disabled={!editable}
        style={({ pressed }) => [styles.main, pressed && styles.pressed]}
        role={isCount ? 'button' : 'checkbox'}
        aria-checked={isCount ? undefined : done}
        aria-disabled={!editable}
        aria-label={[time, a.label, !a.required ? 'optional' : null, skipped ? 'skipped' : null].filter(Boolean).join(', ')}
        aria-valuetext={a11yState}
        accessibilityActions={[
          { name: 'activate' },
          { name: 'skip', label: skipped ? 'Restore' : 'Skip' },
          { name: 'details', label: 'Details' },
        ]}
        onAccessibilityAction={onAction}
      >
        <View style={[styles.mark, done && styles.markDone, skipped && styles.markSkipped]}>
          {done ? <Text style={styles.tick}>✓</Text> : skipped ? <Text style={styles.dash}>–</Text> : null}
        </View>
        {showTime && (
          <Text style={[styles.time, (done || skipped) && styles.textDone]} numberOfLines={1}>
            {time ?? ''}
          </Text>
        )}
        <View style={styles.text}>
          <Text style={[type.body, (done || skipped) && styles.textDone]} numberOfLines={2}>
            {a.label}
          </Text>
          {meta ? (
            <Text style={[type.detail, styles.meta]} numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
        </View>
        {isCount && !skipped && (
          <View style={styles.segments} testID={`count-${a.id}`}>
            {Array.from({ length: target }, (_, i) => (
              <View key={i} style={[styles.segment, i < count && styles.segmentOn]} />
            ))}
          </View>
        )}
      </Pressable>
      <Pressable
        onPress={onMore}
        style={styles.more}
        accessibilityRole="button"
        accessibilityLabel={`${a.label} details`}
        hitSlop={4}
      >
        <Text style={styles.moreText}>›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  next: { borderLeftWidth: 4, borderLeftColor: colors.accent, paddingLeft: space.sm, marginLeft: -space.md },
  row: { flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 64, paddingVertical: space.md, gap: space.md },
  pressed: { opacity: 0.6 },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  markSkipped: { borderStyle: 'dashed' },
  tick: { color: colors.onAccent, fontWeight: '900', fontSize: 15 },
  dash: { color: colors.faint, fontWeight: '900', fontSize: 16, lineHeight: 18 },
  time: { width: 70, fontSize: 14, fontWeight: '600', color: colors.muted, ...type.number },
  text: { flex: 1 },
  meta: { marginTop: 2 },
  textDone: { color: colors.faint },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.faint },
  segmentOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  more: { width: touch, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },
  moreText: { fontSize: 24, color: colors.faint },
});
