import { StyleSheet, Text, View } from 'react-native';
import { formatClock, formatDuration } from '../../format';
import type { Activity } from '../../plan/schema';
import type { PrescriptionItem } from '../../prescription/prescribe';
import { partLabels } from '../../prescription/windows';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { space, type } from '../../ui/theme';
import { SessionExercises } from './SessionExercises';
import { SheetHeader, TextButton } from './Sheets';

type Props = {
  item: PrescriptionItem | null;
  logs: Record<string, ActivityLog | undefined>;
  editable: boolean;
  onClose: () => void;
  onSetDone: (item: PrescriptionItem, a: Activity, done: boolean, variant?: 'full' | 'short') => void;
  onSetSkipped: (item: PrescriptionItem, skipped: boolean) => void;
};

/** Secondary actions for a prescribed item: session details, short version, alternatives, skip/restore. */
export function ItemSheet({ item, logs, editable, onClose, onSetDone, onSetSkipped }: Props) {
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  const a = item?.activity;
  const when = item ? (item.window.time ? formatClock(item.window.time) : partLabels[item.window.part]) : '';
  return (
    <Sheet visible={!!item} onClose={onClose} label={item ? `${item.label} details` : 'Details'}>
      {item && (
        <View style={styles.body}>
          <SheetHeader title={item.label} right={<TextButton title="Close" onPress={onClose} />} />
          <Text style={[type.detail, styles.center]}>
            {[when, a ? formatDuration(a.duration) : null, item.required ? null : 'Optional', item.detail].filter(Boolean).join(' · ')}
          </Text>

          {item.session && (
            <View style={styles.block}>
              <Text style={type.section}>Full session{item.session.minutes ? ` · ${item.session.minutes} min` : ''}</Text>
              <SessionExercises exercises={item.session.exercises} testID="sheet-session" />
              {item.session.short && (
                <>
                  <Text style={[type.section, styles.gap]}>Short version{item.session.short.minutes ? ` · ${item.session.short.minutes} min` : ''}</Text>
                  <SessionExercises exercises={item.session.short.exercises} testID="sheet-session-short" />
                </>
              )}
            </View>
          )}

          <View style={styles.actions}>
            {item.state === 'skipped' ? (
              <Button title="Restore" disabled={!editable} onPress={act(() => onSetSkipped(item, false))} />
            ) : item.kind === 'activity' && a ? (
              <>
                <Button
                  title={item.state === 'done' ? 'Mark not done' : item.session?.short ? 'Done (full session)' : 'Mark done'}
                  disabled={!editable}
                  onPress={act(() => onSetDone(item, a, item.state !== 'done'))}
                />
                {item.session?.short && item.state !== 'done' && (
                  <Button
                    title={`Done (short version${item.session.short.minutes ? `, ${item.session.short.minutes} min` : ''})`}
                    variant="secondary"
                    disabled={!editable}
                    onPress={act(() => onSetDone(item, a, true, 'short'))}
                  />
                )}
                <Button title="Skip" variant="secondary" disabled={!editable} onPress={act(() => onSetSkipped(item, true))} />
              </>
            ) : (
              <>
                {item.options.map((o) => {
                  const isDone = logs[o.id]?.status === 'done';
                  return (
                    <Button
                      key={o.id}
                      title={isDone ? `Undo ${o.label}` : `Done with ${o.label}`}
                      variant={isDone ? 'secondary' : 'primary'}
                      disabled={!editable || (item.state === 'done' && !isDone)}
                      onPress={act(() => onSetDone(item, o, !isDone))}
                    />
                  );
                })}
                <Button title="Skip" variant="secondary" disabled={!editable} onPress={act(() => onSetSkipped(item, true))} />
              </>
            )}
          </View>
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.md, gap: space.md },
  center: { textAlign: 'center' },
  block: { gap: space.sm },
  gap: { marginTop: space.md },
  actions: { gap: space.sm, marginTop: space.sm },
});
