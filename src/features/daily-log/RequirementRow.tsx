import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Activity } from '../../plan/schema';
import type { PrescriptionItem } from '../../prescription/prescribe';
import type { ActivityLog } from '../../storage/types';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';

type Props = {
  item: PrescriptionItem;
  logs: Record<string, ActivityLog | undefined>;
  editable: boolean;
  isNext?: boolean;
  onOption: (a: Activity) => void;
  onMore: () => void;
};

/**
 * A requirement with alternatives (contract 08): any one option satisfies it; once one does,
 * the others show as not needed instead of becoming more work.
 */
export function RequirementRow({ item, logs, editable, isNext, onOption, onMore }: Props) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const done = item.state === 'done';
  const skipped = item.state === 'skipped';
  const sub = done
    ? `Done with ${item.satisfiedBy!.label}${item.variant === 'short' ? ' (short)' : ''}`
    : skipped
      ? 'Skipped'
      : item.detail ?? 'Any one of these counts';
  return (
    <View style={[styles.row, isNext && styles.next]} testID={`requirement-${item.requirement!.id}`}>
      <View style={styles.top}>
        <View style={[styles.mark, done && styles.markDone, skipped && styles.markSkipped]}>
          {done ? <Text style={styles.tick}>✓</Text> : skipped ? <Text style={styles.dash}>–</Text> : null}
        </View>
        <View style={styles.text}>
          <Text style={[type.body, (done || skipped) && styles.faded]}>{item.label}</Text>
          <Text style={type.detail}>{[sub, item.required ? null : 'Optional'].filter(Boolean).join(' · ')}</Text>
        </View>
        <Pressable onPress={onMore} style={styles.more} accessibilityRole="button" accessibilityLabel={`${item.label} details`}>
          <Text style={styles.moreText}>›</Text>
        </Pressable>
      </View>
      {!skipped && (
        <View style={styles.options}>
          {item.options.map((o) => {
            const log = logs[o.id];
            const isDone = log?.status === 'done';
            const notNeeded = done && !isDone;
            const progress = o.tracking.type === 'count' ? ` ${log?.count ?? 0}/${o.tracking.target}` : '';
            return (
              <Pressable
                key={o.id}
                onPress={() => onOption(o)}
                disabled={!editable || notNeeded}
                style={[styles.option, isDone && styles.optionDone, notNeeded && styles.optionIdle]}
                role={o.tracking.type === 'count' ? 'button' : 'checkbox'}
                aria-checked={o.tracking.type === 'count' ? undefined : isDone}
                aria-label={`${o.label}${notNeeded ? ', not needed today' : ''}`}
                aria-valuetext={o.tracking.type === 'count' ? `${log?.count ?? 0} of ${o.tracking.target} ${o.tracking.unitLabel}` : undefined}
                testID={`option-${o.id}`}
              >
                <Text style={[styles.optionText, isDone && styles.optionTextDone]} numberOfLines={1}>
                  {isDone ? '✓ ' : ''}
                  {o.label}
                  {progress}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  row: { paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line, gap: space.sm },
  next: { borderLeftWidth: 4, borderLeftColor: colors.accent, paddingLeft: space.sm, marginLeft: -space.md },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  mark: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  markDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  markSkipped: { borderStyle: 'dashed' },
  tick: { color: colors.onAccent, fontWeight: '900', fontSize: 15 },
  dash: { color: colors.faint, fontWeight: '900', fontSize: 16, lineHeight: 18 },
  text: { flex: 1, minWidth: 0 },
  faded: { color: colors.faint },
  more: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center', marginRight: -space.md },
  moreText: { fontSize: 24, color: colors.faint },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingLeft: 28 + space.md },
  option: {
    minHeight: touch,
    maxWidth: '100%',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  optionDone: { backgroundColor: colors.accent, borderColor: colors.accent },
  optionIdle: { opacity: 0.4 },
  optionText: { fontSize: 15, fontWeight: '600', color: colors.ink, fontVariant: ['tabular-nums'] },
  optionTextDone: { color: colors.onAccent },
}));
