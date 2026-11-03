import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { convertEnergy, entryUnit, roundEnergy, speakEnergy, unitWord, type EnergyDisplay, type EnergyUnit } from '../../energy';
import { formatObservationValue, observationLabel, observationSource } from '../../observations/format';
import { metricDef } from '../../observations/metrics';
import type { Observation } from '../../observations/types';
import { formatMinutes } from '../../observations/units';
import type { Plan } from '../../plan/schema';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { colors, space, touch, type } from '../../ui/theme';
import { ModalHeader } from '../../ui/ModalHeader';
import { TextButton } from './Sheets';

/**
 * Everything else recorded on this date: imported steps/sleep/readiness/workouts, other observations,
 * calculated values, and activity history the current plan no longer schedules. Same for every date.
 */
export function RecordedSection(p: {
  plan: Plan;
  energy: EnergyDisplay;
  observations: Observation[];
  outsidePlan: ActivityLog[];
  onOpen: (o: Observation) => void;
}) {
  if (!p.observations.length && !p.outsidePlan.length) return null;
  return (
    <View testID="recorded">
      <Text style={type.section} accessibilityRole="header">
        Recorded
      </Text>
      <View style={styles.list}>
        {p.observations.map((o) => (
          <Pressable
            key={o.id}
            onPress={() => p.onOpen(o)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={speakEnergy(`${observationLabel(o)} ${formatObservationValue(o, p.plan, p.energy)}, ${observationSource(o)}. Details`)}
            testID={`recorded-${o.metric}`}
          >
            <View style={styles.text}>
              <Text style={[type.body, o.kind === 'inferred' && styles.inferred]} numberOfLines={1}>
                {observationLabel(o)}
              </Text>
              <Text style={type.detail} numberOfLines={1}>
                {observationSource(o)}
              </Text>
            </View>
            <Text style={[styles.value, o.kind === 'inferred' && styles.inferred]} numberOfLines={1}>
              {formatObservationValue(o, p.plan, p.energy)}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
        {p.outsidePlan.map((log) => (
          <View key={log.activityId} style={styles.row} testID={`history-${log.activityId}`}>
            <View style={styles.text}>
              <Text style={type.body} numberOfLines={1}>
                {log.labelSnapshot}
              </Text>
              <Text style={type.detail}>Not in the current plan for this day</Text>
            </View>
            <Text style={styles.value}>{log.status === 'skipped' ? 'Skipped' : log.status === 'done' ? 'Done' : `${log.count} done`}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Provenance plus correction (edit value / remove) for one observation. */
export function ObservationSheet(p: {
  plan: Plan;
  energy: EnergyDisplay;
  observation: Observation | null;
  editable: boolean;
  onClose: () => void;
  onCorrect: (o: Observation, value: number) => void;
  onRemove: (o: Observation) => void;
}) {
  const o = p.observation;
  const def = o ? metricDef(o.metric) : undefined;
  // Energy is corrected in the unit shown first (#39) and stored back in its stored unit (kJ).
  const stored: EnergyUnit = o?.unit === 'kcal' ? 'kcal' : 'kJ';
  const editUnit: EnergyUnit | null = def?.dimension === 'energy' ? entryUnit(p.energy) : null;
  const initial = o ? String(editUnit ? roundEnergy(convertEnergy(o.value, stored, editUnit), editUnit) : o.value) : '';
  const [text, setText] = useState('');
  useEffect(() => {
    setText(initial);
  }, [initial]);
  const n = Number(text.trim().replace(',', '.'));
  const valid = text.trim() !== '' && Number.isFinite(n) && (n >= 0 || o?.metric === 'weight_change');
  const shownUnit = editUnit ?? o?.unit ?? '';
  const facts = o
    ? [
        ['Source', observationSource(o)],
        o.source.evidence ? ['Read from', `“${o.source.evidence}”`] : null,
        o.source.confidence !== null ? ['Confidence', `${Math.round(o.source.confidence * 100)}%`] : null,
        o.source.capturedAt ? ['Captured', new Date(o.source.capturedAt).toLocaleString()] : null,
        ['Saved', new Date(o.recordedAt).toLocaleString()],
      ].filter((x): x is [string, string] => !!x)
    : [];
  return (
    <Sheet visible={!!o} onClose={p.onClose} label={o ? `${observationLabel(o)} details` : 'Details'}>
      {o && (
        <View style={styles.sheet}>
          <ModalHeader
            title={observationLabel(o)}
            dismiss={{ label: p.editable ? 'Cancel' : 'Close', onPress: p.onClose }}
            confirm={
              p.editable
                ? {
                    label: 'Save',
                    disabled: !valid,
                    onPress: () => {
                      // Unchanged text never rewrites the stored value (it was rounded for display).
                      if (text.trim() !== initial) p.onCorrect(o, editUnit ? convertEnergy(n, editUnit, stored) : n);
                      p.onClose();
                    },
                  }
                : undefined
            }
          />
          {o.kind === 'inferred' && <Text style={[type.detail, styles.center]}>Calculated from other values, not measured.</Text>}
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              editable={p.editable}
              keyboardType="decimal-pad"
              style={styles.input}
              accessibilityLabel={`${observationLabel(o)} value in ${unitWord(shownUnit)}`}
              testID="observation-input"
            />
            <Text style={styles.unit}>{shownUnit === 'count' || shownUnit === 'score' ? '' : shownUnit}</Text>
          </View>
          {def?.dimension === 'duration' && valid && <Text style={[type.detail, styles.center]}>{formatMinutes(n)}</Text>}
          <View style={styles.facts}>
            {facts.map(([k, v]) => (
              <View key={k} style={styles.fact}>
                <Text style={[type.detail, styles.factKey]}>{k}</Text>
                <Text style={[type.detail, styles.factValue]}>{v}</Text>
              </View>
            ))}
          </View>
          {p.editable && (
            <Button
              title="Remove"
              variant="secondary"
              onPress={() => {
                p.onRemove(o);
                p.onClose();
              }}
            />
          )}
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { marginTop: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    gap: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { opacity: 0.6 },
  text: { flex: 1, minWidth: 0 },
  value: { fontSize: 17, fontWeight: '700', color: colors.ink, fontVariant: ['tabular-nums'], flexShrink: 0 },
  inferred: { color: colors.muted, fontStyle: 'italic' },
  chevron: { fontSize: 24, color: colors.faint, width: 16, textAlign: 'center' },
  sheet: { paddingBottom: space.md, gap: space.md },
  center: { textAlign: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', gap: space.sm },
  input: {
    fontSize: 36,
    fontWeight: '800',
    color: colors.ink,
    minWidth: 120,
    minHeight: touch,
    textAlign: 'center',
    borderBottomWidth: 2,
    borderBottomColor: colors.line,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: 20, fontWeight: '700', color: colors.muted },
  facts: { gap: space.xs },
  fact: { flexDirection: 'row', gap: space.md },
  factKey: { width: 92 },
  factValue: { flex: 1, color: colors.ink },
});
