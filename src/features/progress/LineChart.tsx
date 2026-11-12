import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { appName } from '../../observations/format';
import { daysBetween, type Point } from '../../progress/series';
import type { Series } from '../../progress/report';
import { space, useTheme, createThemedStyles } from '../../ui/theme';

/**
 * A small time chart (#52). Measured values are dots, calculated values are lines; nothing is drawn between
 * measurements that weren't taken. Tap to inspect the nearest value: its date, value and source.
 */
const H = 132;
/** The right edge is reserved for the axis labels, so data never runs under them. */
const PAD = { top: 10, bottom: 20, left: 6, right: 40 };


const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const source = (p: Point) =>
  p.kind === 'calculated' ? 'calculated' : p.source === 'integration' ? `${p.app ? appName(p.app) : 'another app'}, imported` : p.source === 'screenshot' ? 'from a screenshot' : p.source === 'meals' ? 'from your meals (logged or ticked)' : 'entered by you';

export function LineChart({ series, unit, reference, decimals = 1, testID }: { series: Series[]; unit: string; reference?: { value: number; label: string }; decimals?: number; testID?: string }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const tones = { accent: colors.accent, ink: colors.ink, warm: colors.warm };
  const [width, setWidth] = useState(0);
  const [picked, setPicked] = useState<{ p: Point; label: string } | null>(null);
  const box = useRef<View>(null);
  const all = series.flatMap((s) => [...s.points, ...(s.upper ?? [])]);
  if (!all.length) return null;

  const dates = all.map((p) => p.date).sort();
  const first = dates[0];
  const spanDays = Math.max(1, daysBetween(first, dates[dates.length - 1]));
  const hasBars = series.some((s) => s.style === 'bars' && s.points.length);
  // Bars grow from zero, so zero is always on the scale for them.
  const values = [...all.map((p) => p.value), ...(reference ? [reference.value] : []), ...(hasBars ? [0] : [])];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  // Bars start exactly at zero when nothing is negative.
  lo = hasBars && lo >= 0 ? 0 : lo - pad;
  hi += pad;
  const innerW = Math.max(1, width - PAD.left - PAD.right);
  // Weekly bars sit on their week's Monday; half a week of margin keeps the first and last bars inside.
  const margin = hasBars ? 3.5 : 0;
  const x = (d: string) => PAD.left + ((daysBetween(first, d) + margin) / (spanDays + 2 * margin)) * innerW;
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const inspect = (locX: number) => {
    let best: { p: Point; label: string; d: number } | null = null;
    for (const s of series) for (const p of s.points) {
      const d = Math.abs(x(p.date) - locX);
      if (!best || d < best.d) best = { p, label: s.label, d };
    }
    if (best) setPicked({ p: best.p, label: best.label });
  };

  return (
    <View testID={testID}>
      <Pressable
        ref={box}
        // locationX is relative to whichever SVG shape was tapped; measure from the chart itself instead.
        onPress={(e) => {
          const pageX = e.nativeEvent.pageX;
          box.current?.measureInWindow((left) => inspect(pageX - left));
        }}
        onLayout={onLayout} accessibilityRole="button" accessibilityLabel="Inspect the chart" accessibilityHint="Shows the value nearest where you tap">
        <Svg width="100%" height={H} aria-hidden>
          {[0, 0.5, 1].map((f) => (
            <Line key={f} x1={0} x2={width} y1={PAD.top + f * (H - PAD.top - PAD.bottom)} y2={PAD.top + f * (H - PAD.top - PAD.bottom)} stroke={colors.line} strokeWidth={1} />
          ))}
          {reference ? <Line x1={0} x2={width} y1={y(reference.value)} y2={y(reference.value)} stroke={colors.muted} strokeWidth={1.5} strokeDasharray="5 4" /> : null}
          {series.map((s, i) =>
            s.style === 'bars' ? (
              s.points.map((p) => {
                const bw = Math.max(4, Math.min(18, (innerW / (spanDays / 7 + 1)) * 0.5));
                const top = Math.min(y(p.value), y(0));
                return <Rect key={`${i}-${p.date}`} x={x(p.date) - bw / 2} y={top} width={bw} height={Math.max(1, Math.abs(y(0) - y(p.value)))} rx={2} fill={tones[s.tone]} opacity={0.85} />;
              })
            ) : s.style === 'band' ? (
              s.points.length > 1 && s.upper ? (
                <Polygon key={i} points={[...s.points, ...[...s.upper].reverse()].map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} fill={tones[s.tone]} opacity={0.18} />
              ) : null
            ) : s.style === 'dashed' ? (
              s.points.length > 1 ? (
                <Polyline key={i} points={s.points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} fill="none" stroke={tones[s.tone]} strokeWidth={2} strokeDasharray="6 4" />
              ) : null
            ) : s.style === 'line' ? (
              s.points.length > 1 ? (
                <Polyline key={i} points={s.points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')} fill="none" stroke={tones[s.tone]} strokeWidth={2.5} strokeLinejoin="round" />
              ) : s.points.length === 1 ? (
                <Circle key={i} cx={x(s.points[0].date)} cy={y(s.points[0].value)} r={3} fill={tones[s.tone]} />
              ) : null
            ) : (
              s.points.map((p) => <Circle key={`${i}-${p.date}`} cx={x(p.date)} cy={y(p.value)} r={3.5} fill={tones[s.tone]} opacity={s.tone === 'accent' ? 0.55 : 0.9} />)
            ),
          )}
          {picked ? <Line x1={x(picked.p.date)} x2={x(picked.p.date)} y1={PAD.top} y2={H - PAD.bottom} stroke={colors.ink} strokeWidth={1} opacity={0.35} /> : null}
          <SvgText x={PAD.left} y={H - 4} fontSize={11} fill={colors.muted}>
            {shortDate(first)}
          </SvgText>
          <SvgText x={width - PAD.right} y={H - 4} fontSize={11} fill={colors.muted} textAnchor="middle">
            {shortDate(dates[dates.length - 1])}
          </SvgText>
          <SvgText x={width - 2} y={PAD.top + 4} fontSize={11} fill={colors.muted} textAnchor="end">
            {`${hi.toFixed(decimals)}`}
          </SvgText>
          <SvgText x={width - 2} y={H - PAD.bottom + 4} fontSize={11} fill={colors.muted} textAnchor="end">
            {`${lo.toFixed(decimals)}`}
          </SvgText>
        </Svg>
      </Pressable>
      <View style={styles.legend}>
        {series.filter((s) => s.points.length).map((s) => (
          <View key={s.label} style={styles.legendItem}>
            <View style={[s.style === 'line' || s.style === 'dashed' ? styles.swLine : s.style === 'bars' ? styles.swBar : s.style === 'band' ? styles.swBand : styles.swDot, { backgroundColor: tones[s.tone] }, s.style === 'band' && styles.swBandFade]} />
            <Text style={styles.legendText}>{s.label}</Text>
          </View>
        ))}
        {reference ? (
          <View style={styles.legendItem}>
            <View style={[styles.swLine, styles.swDash]} />
            <Text style={styles.legendText}>{reference.label}</Text>
          </View>
        ) : null}
      </View>
      {picked ? (
        <Text style={styles.picked} accessibilityLiveRegion="polite" testID={testID ? `${testID}-picked` : undefined}>
          {`${shortDate(picked.p.date)} · ${picked.p.value.toFixed(decimals)} ${unit} · ${picked.label}, ${source(picked.p)}`}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.md, rowGap: 2, marginTop: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  swDot: { width: 8, height: 8, borderRadius: 4 },
  swLine: { width: 14, height: 3, borderRadius: 2 },
  swBar: { width: 8, height: 12, borderRadius: 2 },
  swBand: { width: 14, height: 10, borderRadius: 2 },
  swBandFade: { opacity: 0.3 },
  swDash: { backgroundColor: colors.muted, opacity: 0.6 },
  legendText: { fontSize: 12, color: colors.muted, flexShrink: 1 },
  picked: { marginTop: space.xs, fontSize: 13, color: colors.ink, fontWeight: '600' },
}));
