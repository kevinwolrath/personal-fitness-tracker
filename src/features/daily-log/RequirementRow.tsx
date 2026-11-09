import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Activity } from '../../plan/schema';
import type { PrescriptionItem } from '../../prescription/prescribe';
import type { ActivityLog } from '../../storage/types';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { requirementView } from '../../prescription/conditioning';

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
  const { type } = useTheme();
  const styles = useStyles();

  const done = item.state === 'done';
  const skipped = item.state === 'skipped';
  // #90 layout A: one activity, its methods as stacked choices with doses; the method in progress is highlighted.
  const view = requirementView(item, logs);
  const sub = [view.status, item.required ? null : 'Optional'].filter(Boolean).join(' · ');
  return (
    <View style={[styles.row, isNext && styles.next]} testID={`requirement-${item.requirement!.id}`}>
      <View style={styles.top}>
        <View style={[styles.mark, done && styles.markDone, skipped && styles.markSkipped]}>
          {done ? <Text style={styles.tick}>✓</Text> : skipped ? <Text style={styles.dash}>–</Text> : null}
        </View>
        <View style={styles.text}>
          <Text style={[type.body, (done || skipped) && styles.faded]}>{item.label}</Text>
          <Text style={[type.detail, done && styles.doneSub]} testID={`requirement-status-${item.requirement!.id}`}>{sub}</Text>
        </View>
        <Pressable onPress={onMore} style={styles.more} accessibilityRole="button" accessibilityLabel={`${item.label} details`}>
          <Text style={styles.moreText}>›</Text>
        </Pressable>
      </View>
      {/* Done: collapsed to the status line; undo or switch from the sheet (›). */}
      {!skipped && !done && (
        <View style={styles.options}>
          {view.options.map((o) => {
            const a = o.activity;
            const active = o.state === 'active';
            const detail = active && o.progress ? `${o.progress.count} of ${o.progress.target} ${o.progress.unit}` : o.dose;
            return (
              <Pressable
                key={a.id}
                onPress={() => onOption(a)}
                disabled={!editable}
                style={({ pressed }) => [styles.option, active && styles.optionActive, view.chosen && !active && styles.optionIdle, pressed && styles.pressed]}
                role={a.tracking.type === 'count' ? 'button' : 'radio'}
                aria-checked={a.tracking.type === 'count' ? undefined : active}
                aria-label={`${a.label}${o.dose ? `, ${o.dose}` : ''}`}
                aria-valuetext={o.progress ? `${o.progress.count} of ${o.progress.target} ${o.progress.unit}` : undefined}
                testID={`option-${a.id}`}
              >
                <View style={[styles.radio, active && styles.radioOn]} />
                <View style={styles.text}>
                  <Text style={styles.optionText}>{a.label}</Text>
                  {detail ? <Text style={type.detail} numberOfLines={2}>{detail}</Text> : null}
                </View>
                {o.progress && (
                  <View style={styles.segments} testID={`option-progress-${a.id}`}>
                    {Array.from({ length: o.progress.target }, (_, i) => (
                      <View key={i} style={[styles.segment, i < o.progress!.count && styles.segmentOn]} />
                    ))}
                  </View>
                )}
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
  doneSub: { color: colors.ink, fontWeight: '600' },
  options: { gap: space.sm, paddingLeft: 28 + space.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touch + space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  optionActive: { borderColor: colors.accent, borderWidth: 2 },
  optionIdle: { opacity: 0.55 },
  pressed: { opacity: 0.75 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.faint },
  radioOn: { borderWidth: 7, borderColor: colors.accent },
  optionText: { fontSize: 15, fontWeight: '700', color: colors.ink },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: colors.faint },
  segmentOn: { backgroundColor: colors.accent, borderColor: colors.accent },
}));
