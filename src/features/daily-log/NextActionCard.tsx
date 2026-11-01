import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatClock } from '../../format';
import type { Activity } from '../../plan/schema';
import type { NextAction } from '../../prescription/nextAction';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { partLabels } from '../../prescription/windows';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { colors, radius, space, touch, type } from '../../ui/theme';
import type { PrescribedExercise } from '../../prescription/session';
import { SessionExercises } from './SessionExercises';

type Props = {
  next: NextAction | null;
  progress: { done: number; total: number };
  logs: Record<string, ActivityLog | undefined>;
  onAdvance: (item: PrescriptionItem, a: Activity) => void;
  onDetails: (item: PrescriptionItem) => void;
  /** Opens the exercise guide for a prescribed exercise (contract 09). */
  onOpenExercise?: (e: PrescribedExercise) => void;
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
export function NextActionCard({ next, progress, logs, onAdvance, onDetails, onOpenExercise }: Props) {
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
  const session = item.session;
  return (
    <View style={styles.card} testID="next-action" accessibilityLiveRegion="polite">
      <Text style={styles.eyebrow}>Do this next</Text>
      <Text style={styles.title} accessibilityRole="header" testID="next-action-title">
        {item.label}
      </Text>
      <Text style={styles.sub} testID="next-action-when">
        {[whenLabel(next), session?.minutes ? `${session.minutes} min` : null, item.detail].filter(Boolean).join(' · ')}
      </Text>
      {session && (
        <View style={styles.session}>
          <SessionExercises exercises={session.exercises} testID="next-action-session" onOpen={onOpenExercise} />
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
          <Text style={styles.detailsText}>{session?.short ? 'Short version, skip and more' : 'Skip and more'}</Text>
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
  session: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginTop: space.sm },
  actions: { gap: space.sm, marginTop: space.md },
  details: { minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  detailsText: { color: colors.onInkMuted, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
});
