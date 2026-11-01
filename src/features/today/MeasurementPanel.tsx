import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatMeasurement, formatShortDate } from '../../format';
import type { LocalDate } from '../../plan/dates';
import type { Measurement, Plan } from '../../plan/schema';
import { measurementMetric } from '../../observations/planMetrics';
import type { Observation } from '../../observations/types';
import { colors, radius, space, type } from '../../ui/theme';

type Props = {
  plan: Plan;
  date: LocalDate;
  due: Measurement[];
  latest: Record<string, Observation | null>;
  editable: boolean;
  onLog: (m: Measurement) => void;
};

/** Measurements scheduled for this day, with the plan goal for each (contract 03 §6). */
export function MeasurementPanel({ plan, date, due, latest, editable, onLog }: Props) {
  if (!due.length) return null;
  return (
    <View style={styles.row}>
      {due.map((m) => {
        const obs = latest[m.id];
        const entry = obs && { ...obs, value: measurementMetric(plan, m).toPlan(obs.value) };
        const loggedToday = entry?.date === date;
        const via = loggedToday && entry.source.type === 'screenshot' ? `From ${entry.source.app ?? 'screenshot'}` : null;
        const goal = plan.goals.find((g) => g.measurementId === m.id);
        let goalText = goal ? `${goal.label} ${formatMeasurement(plan, m, goal.target)}` : null;
        if (goal && entry) {
          const gap = goal.direction === 'increase' ? goal.target - entry.value : entry.value - goal.target;
          if (goal.direction !== 'maintain' && gap > 0) goalText += ` · ${formatMeasurement(plan, m, gap)} to go`;
        }
        return (
          <Pressable
            key={m.id}
            onPress={() => onLog(m)}
            disabled={!editable}
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${m.label}: ${entry ? formatMeasurement(plan, m, entry.value) : 'not logged'}${loggedToday ? '' : ', log now'}`}
            testID={`measurement-${m.id}`}
          >
            <View style={styles.cellTop}>
              <Text style={styles.label}>{m.label}</Text>
              {editable && <Text style={styles.action}>{loggedToday ? 'Edit' : 'Log'}</Text>}
            </View>
            <Text style={[styles.value, !loggedToday && styles.valueStale, !entry && styles.valueEmpty]}>
              {entry ? formatMeasurement(plan, m, entry.value) : 'Not logged'}
            </Text>
            <Text style={type.detail} numberOfLines={1}>
              {!loggedToday && entry ? `Last ${formatShortDate(entry.date)}` : (via ?? goalText ?? ' ')}
            </Text>
            {((!loggedToday && entry) || via) && goalText ? (
              <Text style={type.detail} numberOfLines={1}>
                {goalText}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, minHeight: 96 },
  pressed: { opacity: 0.75 },
  cellTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: type.section,
  action: { fontSize: 15, fontWeight: '700', color: colors.accent },
  value: { fontSize: 26, fontWeight: '800', color: colors.ink, marginVertical: space.xs, ...type.number },
  valueStale: { color: colors.faint },
  valueEmpty: { fontSize: 20, fontWeight: '700' },
});
