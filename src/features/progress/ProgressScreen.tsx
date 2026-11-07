import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Observation } from '../../observations/types';
import { preferences } from '../../platform/preferences';
import { chartLayout, planVersionsFrom, type ProgressOptions, chartTitles, progressMetrics, progressReport, ranges, type ChartId, type ChartModel, type RangeId } from '../../progress/report';
import type { WeekCompare } from '../../progress/series';
import { useApp } from '../../providers/AppProvider';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { useClock } from '../daily-log/useDay';
import { LineChart } from './LineChart';

/**
 * Progress (#52, layout A): a tab beside Today. Screen header: title, range and Edit charts; content: this week vs
 * last, then one card per chart in the user's order. Read-only: values are entered and corrected on Today.
 */
export function ProgressScreen() {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { store, plan, energy, dataVersion } = useApp();
  const { today } = useClock();
  const [observations, setObservations] = useState<Observation[] | null>(null);
  const [history, setHistory] = useState<ProgressOptions['history']>(undefined);
  const [range, setRange] = useState<RangeId>('30d');
  const [layout, setLayout] = useState(chartLayout(null));
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    store.observationsFor(progressMetrics).then(setObservations, () => setObservations([]));
    // The plan's records plus its earlier versions (#67), so past days are compared with the schedule they had.
    Promise.all([store.planHistory(plan.id), store.configHistory()]).then(
      ([h, changes]) => setHistory({ ...h, planVersions: planVersionsFrom(changes) }),
      () => setHistory(undefined),
    );
  }, [store, plan.id]);
  useEffect(load, [load, dataVersion]);
  useFocusEffect(load); // values logged on Today show when switching back
  useEffect(() => {
    preferences.progressCharts().then((v) => setLayout(chartLayout(v)));
  }, []);
  const saveLayout = (next: { order: ChartId[]; hidden: ChartId[] }) => {
    setLayout(next);
    preferences.setProgressCharts(next).catch(() => undefined);
  };

  const report = useMemo(() => (observations ? progressReport(observations, plan, today, range, { energy, history }) : null), [observations, plan, today, range, energy, history]);
  const visible = layout.order.filter((id) => !layout.hidden.includes(id));

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} testID="progress-scroll">
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={type.title} accessibilityRole="header">
              Progress
            </Text>
            <Pressable onPress={() => setEditing(true)} style={styles.link} accessibilityRole="button" accessibilityLabel="Edit charts" testID="edit-charts">
              <Text style={styles.linkText}>Edit charts</Text>
            </Pressable>
          </View>
          <View style={styles.ranges} accessibilityRole="radiogroup" accessibilityLabel="Range">
            {ranges.map((r) => (
              <Pressable
                key={r.id}
                onPress={() => setRange(r.id)}
                style={[styles.range, range === r.id && styles.rangeOn]}
                accessibilityRole="radio"
                accessibilityState={{ checked: range === r.id }}
                aria-checked={range === r.id}
                accessibilityLabel={r.label}
                testID={`range-${r.id}`}
              >
                <Text style={[styles.rangeText, range === r.id && styles.rangeTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {report ? (
          <>
            <View style={styles.summary} testID="progress-summary">
              <Text style={styles.summaryTitle}>This week vs last</Text>
              <View style={styles.summaryRow}>
                <Stat label="Weight (average)" c={report.summary.weight} unit={report.summary.mass} />
                <Stat label="Waist" c={report.summary.waist} unit={report.summary.length} />
                <View style={styles.stat}>
                  <Text style={styles.statValue}>{String(report.summary.workouts.thisWeek ?? 0)}</Text>
                  <Text style={styles.statLabel}>{`Workouts this week${report.summary.workouts.lastWeek !== null ? ` (${report.summary.workouts.lastWeek} last week)` : ''}`}</Text>
                </View>
              </View>
            </View>
            {visible.map((id) => (
              <ChartCard key={id} model={report.charts[id]} />
            ))}
            {!visible.length ? <Text style={type.detail}>All charts are hidden. Use Edit charts to show them.</Text> : null}
            <Text style={styles.footnote}>Dots are values as recorded; lines are calculated. Nothing is filled in between measurements.</Text>
          </>
        ) : null}
      </ScrollView>
      <EditChartsSheet visible={editing} layout={layout} onChange={saveLayout} onClose={() => setEditing(false)} />
    </SafeAreaView>
  );
}

function Stat({ label, c, unit, decimals = 1 }: { label: string; c: WeekCompare; unit: string; decimals?: number }) {
  const styles = useStyles();

  const value = (c.change !== null ? `${c.change > 0 ? '+' : c.change < 0 ? '−' : ''}${Math.abs(c.change).toFixed(decimals)} ${unit}` : c.thisWeek !== null ? `${c.thisWeek.toFixed(decimals)} ${unit}` : '—').trim();
  const sub = c.change !== null ? label : c.thisWeek !== null ? `${label}, no data last week` : `${label}, no data this week`;
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{sub}</Text>
    </View>
  );
}

function ChartCard({ model }: { model: ChartModel }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.card} testID={`chart-${model.id}`} accessibilityLabel={model.summary}>
      <View style={styles.cardHead}>
        <Text style={type.section}>{model.title}</Text>
        {model.tag ? <Text style={[styles.tag, model.tag === 'Estimate' ? styles.tagEst : styles.tagCalc]}>{model.tag}</Text> : null}
      </View>
      {model.empty ? (
        <Text style={styles.empty} testID={`chart-${model.id}-empty`}>
          {model.empty}
        </Text>
      ) : (
        <>
          {model.headline ? <Text style={styles.headline}>{model.headline}</Text> : null}
          {model.sub ? <Text style={type.detail}>{model.sub}</Text> : null}
          <LineChart series={model.series} unit={model.unit} reference={model.reference} decimals={model.id === 'rate' ? 2 : ['workouts', 'active-minutes', 'steps', 'energy', 'energy-balance', 'protein'].includes(model.id) ? 0 : 1} testID={`chart-${model.id}-plot`} />
          {model.note ? <Text style={styles.note}>{model.note}</Text> : null}
        </>
      )}
    </View>
  );
}

/** Show, hide and reorder charts with buttons (no drag: works with screen readers and on every platform). */
function EditChartsSheet({ visible, layout, onChange, onClose }: { visible: boolean; layout: { order: ChartId[]; hidden: ChartId[] }; onChange: (l: { order: ChartId[]; hidden: ChartId[] }) => void; onClose: () => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const move = (i: number, d: -1 | 1) => {
    const order = [...layout.order];
    [order[i], order[i + d]] = [order[i + d], order[i]];
    onChange({ ...layout, order });
  };
  return (
    <Sheet visible={visible} onClose={onClose} label="Edit charts">
      <ModalHeader title="Edit charts" dismiss={{ label: 'Close', onPress: onClose }} />
      <View style={styles.sheetBody} testID="edit-charts-sheet">
        <Text style={type.detail}>Hidden charts keep their data. This is a choice on this phone.</Text>
        {layout.order.map((id, i) => {
          const shown = !layout.hidden.includes(id);
          return (
            <View key={id} style={styles.editRow} testID={`edit-${id}`}>
              <Pressable
                onPress={() => onChange({ ...layout, hidden: shown ? [...layout.hidden, id] : layout.hidden.filter((x) => x !== id) })}
                style={styles.editToggle}
                accessibilityRole="switch"
                accessibilityState={{ checked: shown }}
                aria-checked={shown}
                accessibilityLabel={`Show ${chartTitles[id]}`}
              >
                <View style={[styles.box, shown && styles.boxOn]}>{shown ? <Text style={styles.tick}>✓</Text> : null}</View>
                <Text style={[styles.editLabel, !shown && styles.muted]}>{chartTitles[id]}</Text>
              </Pressable>
              <Pressable onPress={() => move(i, -1)} disabled={i === 0} style={[styles.arrow, i === 0 && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Move ${chartTitles[id]} up`}>
                <Text style={styles.arrowText}>↑</Text>
              </Pressable>
              <Pressable onPress={() => move(i, 1)} disabled={i === layout.order.length - 1} style={[styles.arrow, i === layout.order.length - 1 && styles.disabled]} accessibilityRole="button" accessibilityLabel={`Move ${chartTitles[id]} down`}>
                <Text style={styles.arrowText}>↓</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.xxl, gap: space.md },
  header: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  link: { minHeight: touch, minWidth: touch, justifyContent: 'center', alignItems: 'flex-end' },
  linkText: { fontSize: 16, fontWeight: '700', color: colors.accent },
  ranges: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  range: { minHeight: touch, minWidth: touch, paddingHorizontal: space.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  rangeOn: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rangeText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  rangeTextOn: { fontWeight: '800' },
  summary: { backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  summaryTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.onInkAction },
  summaryRow: { flexDirection: 'row', gap: space.lg },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 20, fontWeight: '800', color: colors.onCard },
  statLabel: { fontSize: 12, color: colors.onInkMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.xs },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tag: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3, overflow: 'hidden' },
  tagCalc: { backgroundColor: colors.line, color: colors.ink },
  tagEst: { backgroundColor: colors.accentSoft, color: colors.accent },
  headline: { fontSize: 24, fontWeight: '800', color: colors.ink },
  empty: { fontSize: 14, color: colors.muted, lineHeight: 20, paddingVertical: space.sm },
  note: { fontSize: 12, color: colors.muted, lineHeight: 17, marginTop: space.xs },
  footnote: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  muted: { color: colors.muted },
  sheetBody: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.xs },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  editToggle: { flex: 1, minHeight: touch, flexDirection: 'row', alignItems: 'center', gap: space.md },
  editLabel: { fontSize: 16, fontWeight: '600', color: colors.ink },
  box: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tick: { color: colors.onAccent, fontSize: 15, fontWeight: '800' },
  arrow: { minWidth: touch, minHeight: touch, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 20, color: colors.ink },
  disabled: { opacity: 0.3 },
}));
