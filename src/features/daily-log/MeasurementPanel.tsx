import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { LocalDate } from '../../plan/dates';
import type { Measurement, Plan } from '../../plan/schema';
import { measurementTile } from '../../observations/measurementTile';
import type { Observation } from '../../observations/types';
import { radius, space, useTheme, createThemedStyles } from '../../ui/theme';

type Props = {
  plan: Plan;
  date: LocalDate;
  due: Measurement[];
  latest: Record<string, Observation | null>;
  editable: boolean;
  onLog: (m: Measurement) => void;
};

/**
 * Body measurements (#108): every plan measurement on every day, with its latest value and the date it was measured,
 * or an "Add" when there's none. A measurement's cadence (waist on Sundays) is only a "Due today" hint; it never hides
 * the tile or blocks entry, on any date.
 */
export function MeasurementPanel({ plan, date, due, latest, editable, onLog }: Props) {
  const { type } = useTheme();
  const styles = useStyles();

  if (!plan.measurements.length) return null;
  const dueIds = new Set(due.map((m) => m.id));
  return (
    <View style={styles.row} testID="measurements">
      {plan.measurements.map((m) => {
        const t = measurementTile(plan, m, latest[m.id], date, dueIds.has(m.id));
        const empty = t.value === null;
        return (
          <Pressable
            key={m.id}
            onPress={() => onLog(m)}
            disabled={!editable}
            style={({ pressed }) => [styles.cell, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`${m.label}: ${t.value ?? 'not logged'}${t.detail ? `, ${t.detail}` : ''}${editable ? (empty ? `. Add ${m.label.toLowerCase()}` : t.today ? '. Edit' : ', log now') : ''}`}
            testID={`measurement-${m.id}`}
          >
            <View style={styles.cellTop}>
              <Text style={styles.label}>{m.label}</Text>
              {editable && !empty && <Text style={styles.action}>{t.action}</Text>}
            </View>
            <Text style={[styles.value, !t.today && styles.valueStale, empty && (editable ? styles.valueAdd : styles.valueEmpty)]} numberOfLines={1}>
              {t.value ?? (editable ? `+ Add ${m.label.toLowerCase()}` : 'Not logged')}
            </Text>
            <Text style={type.detail} numberOfLines={1} testID={`measurement-${m.id}-detail`}>
              {t.detail ?? ' '}
            </Text>
            {t.goal ? (
              <Text style={type.detail} numberOfLines={1}>
                {t.goal}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, minHeight: 96 },
  pressed: { opacity: 0.75 },
  cellTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: type.section,
  action: { fontSize: 15, fontWeight: '700', color: colors.accent },
  value: { fontSize: 26, fontWeight: '800', color: colors.ink, marginVertical: space.xs, ...type.number },
  valueStale: { color: colors.faint },
  valueEmpty: { fontSize: 20, fontWeight: '700' },
  valueAdd: { fontSize: 18, fontWeight: '700', color: colors.accent },
}));
