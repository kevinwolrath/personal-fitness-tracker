import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatDuration, formatMeasurement, formatTimestamp, measurementUnit, parseDecimal } from '../../format';
import type { Activity, Measurement, Plan } from '../../plan/schema';
import { measurementMetric } from '../../observations/planMetrics';
import type { Observation } from '../../observations/types';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { colors, radius, space, touch, type } from '../../ui/theme';

function SheetHeader({ title, left, right }: { title: string; left?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerSide}>{left}</View>
      <Text style={[type.body, styles.headerTitle]} accessibilityRole="header" numberOfLines={1}>
        {title}
      </Text>
      <View style={[styles.headerSide, styles.headerRight]}>{right}</View>
    </View>
  );
}

function TextButton({ title, onPress, disabled, strong }: { title: string; onPress: () => void; disabled?: boolean; strong?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.textButton} accessibilityRole="button" accessibilityLabel={title}>
      <Text style={[styles.textButtonText, strong && styles.strong, disabled && styles.disabled]}>{title}</Text>
    </Pressable>
  );
}

/** Secondary actions for one activity (contract 02). Never needed for the happy path. */
export function ActivitySheet(p: {
  activity: Activity | null;
  log: ActivityLog | undefined;
  editable: boolean;
  onClose: () => void;
  onSetDone: (done: boolean) => void;
  onSetSkipped: (skipped: boolean) => void;
}) {
  const a = p.activity;
  const status = p.log?.status ?? 'pending';
  const meta = a ? [formatDuration(a.duration), a.required ? null : 'Optional'].filter(Boolean).join(' · ') : '';
  return (
    <Sheet visible={!!a} onClose={p.onClose} label={a ? `${a.label} details` : 'Details'}>
      {a && (
        <View style={styles.body}>
          <SheetHeader title={a.label} right={<TextButton title="Close" onPress={p.onClose} />} />
          {a.detail ? <Text style={[type.detail, styles.center]}>{a.detail}</Text> : null}
          {meta ? <Text style={[type.detail, styles.center]}>{meta}</Text> : null}
          {a.tracking.type === 'count' && status !== 'skipped' ? (
            <Text style={[type.detail, styles.center]}>
              {p.log?.count ?? 0} of {a.tracking.target} {a.tracking.unitLabel}
            </Text>
          ) : null}
          <View style={styles.actions}>
            {status === 'skipped' ? (
              <Button title="Restore" disabled={!p.editable} onPress={() => (p.onSetSkipped(false), p.onClose())} />
            ) : (
              <>
                <Button
                  title={status === 'done' ? 'Mark not done' : 'Mark done'}
                  disabled={!p.editable}
                  onPress={() => (p.onSetDone(status !== 'done'), p.onClose())}
                />
                <Button title="Skip" variant="secondary" disabled={!p.editable} onPress={() => (p.onSetSkipped(true), p.onClose())} />
              </>
            )}
          </View>
        </View>
      )}
    </Sheet>
  );
}

/** Numeric entry for one measurement; also lists this day's entries for correction. */
export function MeasureSheet(p: {
  plan: Plan;
  measurement: Measurement | null;
  /** This day's observations for the measurement's metric (any source). */
  entries: Observation[];
  prefill: number | null;
  onClose: () => void;
  onSave: (value: number) => void;
  onRemove: (id: string) => void;
}) {
  const m = p.measurement;
  const [text, setText] = useState('');
  useEffect(() => {
    if (m) setText(p.prefill != null ? p.prefill.toFixed(m.decimals) : '');
  }, [m, p.prefill]);
  const value = parseDecimal(text);
  const save = () => {
    if (value === null) return;
    p.onSave(value);
    p.onClose();
  };
  return (
    <Sheet visible={!!m} onClose={p.onClose} label={m ? `Log ${m.label}` : 'Log'}>
      {m && (
        <View style={styles.body}>
          <SheetHeader
            title={m.label}
            left={<TextButton title="Cancel" onPress={p.onClose} />}
            right={<TextButton title="Save" onPress={save} disabled={value === null} strong />}
          />
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              keyboardType="decimal-pad"
              autoFocus
              selectTextOnFocus
              onSubmitEditing={save}
              returnKeyType="done"
              style={styles.input}
              accessibilityLabel={`${m.label} in ${measurementUnit(p.plan, m)}`}
              testID="measure-input"
            />
            <Text style={styles.unit}>{measurementUnit(p.plan, m)}</Text>
          </View>
          {p.entries.length > 0 && (
            <View style={styles.entries}>
              <Text style={type.section}>Logged this day</Text>
              {p.entries.map((e) => (
                <View key={e.id} style={styles.entry}>
                  <Text style={[type.body, styles.entryText]}>
                    {formatMeasurement(p.plan, m, measurementMetric(p.plan, m).toPlan(e.value))}{' '}
                    <Text style={type.detail}>
                      · {e.source.type === 'manual' ? formatTimestamp(e.recordedAt) : `${e.source.app ?? e.source.type}${e.source.edited ? ' (edited)' : ''}`}
                    </Text>
                  </Text>
                  <TextButton title="Remove" onPress={() => p.onRemove(e.id)} />
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </Sheet>
  );
}

/** Choose this date's day type; choosing the plan default clears the override. */
export function DayTypeSheet(p: {
  plan: Plan;
  visible: boolean;
  currentId: string;
  defaultId: string;
  editable: boolean;
  onClose: () => void;
  onChoose: (dayTypeId: string | null) => void;
}) {
  return (
    <Sheet visible={p.visible} onClose={p.onClose} label="Day type">
      <View style={styles.body}>
        <SheetHeader title="Day type" right={<TextButton title="Close" onPress={p.onClose} />} />
        {p.plan.dayTypes.map((d) => {
          const selected = d.id === p.currentId;
          return (
            <Pressable
              key={d.id}
              disabled={!p.editable}
              onPress={() => {
                p.onChoose(d.id === p.defaultId ? null : d.id);
                p.onClose();
              }}
              style={styles.option}
              role="radio"
              aria-checked={selected}
              aria-disabled={!p.editable}
              aria-label={d.label}
            >
              <Text style={[type.body, styles.optionText]}>{d.label}</Text>
              {d.id === p.defaultId && <Text style={type.detail}>Plan default</Text>}
              <Text style={styles.check}>{selected ? '✓' : ''}</Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.md },
  header: { flexDirection: 'row', alignItems: 'center', minHeight: touch, marginBottom: space.sm },
  headerSide: { flex: 1, flexDirection: 'row' },
  headerRight: { justifyContent: 'flex-end' },
  headerTitle: { flex: 2, textAlign: 'center' },
  textButton: { minHeight: touch, minWidth: touch, justifyContent: 'center' },
  textButtonText: { fontSize: 17, color: colors.accent, fontWeight: '600' },
  strong: { fontWeight: '800' },
  disabled: { color: colors.faint },
  center: { textAlign: 'center', marginTop: space.xs },
  actions: { gap: space.sm, marginTop: space.xl },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', marginVertical: space.xl, gap: space.sm },
  input: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.ink,
    minWidth: 140,
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.line,
    paddingVertical: space.xs,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 22, fontWeight: '700', color: colors.muted },
  entries: { gap: space.xs },
  entry: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  entryText: { flex: 1, fontSize: 16 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    borderRadius: radius.sm,
  },
  optionText: { flex: 1 },
  check: { width: 24, fontSize: 18, color: colors.accent, fontWeight: '800', textAlign: 'right' },
});
