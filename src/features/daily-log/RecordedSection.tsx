import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { convertEnergy, entryUnit, roundEnergy, speakEnergy, unitWord, type EnergyDisplay, type EnergyUnit } from '../../energy';
import { appName, formatObservationValue, observationLabel, observationSource, sourcePackages } from '../../observations/format';
import { activitySummary, interval, isWalk } from '../../observations/activity';
import { metricDef } from '../../observations/metrics';
import type { Observation } from '../../observations/types';
import { formatDistance, formatMinutes } from '../../observations/units';
import type { Plan } from '../../plan/schema';
import type { ActivityLog } from '../../storage/types';
import { Button } from '../../ui/Button';
import { Sheet } from '../../ui/Sheet';
import { space, touch, useTheme, createThemedStyles } from '../../ui/theme';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
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
  const { colors, type } = useTheme();
  const styles = useStyles();
  const [expanded,setExpanded] = useState(false);
  const {fontScale} = useWindowDimensions();
  const walks=p.observations.filter(isWalk);
  const walking=activitySummary(walks);
  const walkingCount = walking.overlap || walking.uncertainTime ? walking.records.length : walking.unique.length;
  const walkingNoun = walking.overlap || walking.uncertainTime ? 'record' : 'walk';
  const walkingCaption = `${walkingCount} ${walkingNoun}${walkingCount === 1 ? '' : 's'}`;
  const tiles=p.observations.filter(o=>o.source.type==='integration' && o.source.importId==='health-connect' && ['steps','active_energy','sleep_duration'].includes(o.metric));
  const remaining=p.observations.filter(o=>!walks.includes(o) && !tiles.includes(o));
  const time=(o:Observation)=> {
    const start=o.activity?.start??o.source.capturedAt;
    if(!start || !Number.isFinite(Date.parse(start)))return 'Time unavailable';
    const display=(s:string)=>new Date(s).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    return `${display(start)}${o.activity?`–${display(o.activity.end)}`:''}`;
  };
  const row=(o:Observation,walk=false)=>(
    <Pressable key={o.id} onPress={()=>p.onOpen(o)} style={({pressed})=>[styles.row,walk&&styles.walkRow,pressed&&styles.pressed]} accessibilityRole="button" accessibilityLabel={speakEnergy(`${observationLabel(o)} ${formatObservationValue(o,p.plan,p.energy)}, ${walk?time(o)+', ':''}${observationSource(o)}. Details`)} testID={`recorded-${o.metric}`}>
      <View style={styles.text}>
        <Text style={[type.body,o.kind==='inferred'&&styles.inferred]}>{observationLabel(o)}</Text>
        <Text style={type.detail}>{walk?`${time(o)} · ${o.source.app?appName(o.source.app):'Health Connect'}`:observationSource(o)}</Text>
        {walk&&walking.duplicates.has(o.id)&&<Text style={styles.hint}>Overlapping source record</Text>}
      </View>
      <Text style={[styles.value,styles.wrappingValue,o.kind==='inferred'&&styles.inferred]}>{formatObservationValue(o,p.plan,p.energy)}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );

  if (!p.observations.length && !p.outsidePlan.length) return null;
  return (
    <View testID="recorded">
      <Text style={type.section} accessibilityRole="header">
        Recorded
      </Text>
      <View style={styles.list}>
        {!!tiles.length&&<View testID="recorded-health-grid">
          <Text style={styles.hint}>Health Connect</Text>
          <View style={styles.grid}>{tiles.map(o=><Pressable key={o.id} onPress={()=>p.onOpen(o)} accessibilityRole="button" accessibilityLabel={speakEnergy(`${observationLabel(o)} ${formatObservationValue(o,p.plan,p.energy)}, ${observationSource(o)}. Details`)} testID={`recorded-${o.metric}`} style={[styles.tile,{minWidth:fontScale>1.3?140:96}]}>
            <Text style={type.detail}>{observationLabel(o)}</Text><Text style={styles.tileValue}>{formatObservationValue(o,p.plan,p.energy)}</Text>
            {!!o.source.app&&<Text style={styles.hint}>{appName(o.source.app)}</Text>}
          </Pressable>)}</View>
        </View>}
        {!!walks.length&&<View>
          <Pressable style={styles.walkSummary} onPress={()=>setExpanded(!expanded)} accessibilityRole="button" accessibilityState={{expanded}} accessibilityLabel={`Walking, ${walkingCaption}, ${walking.uncertainTime?'at least ':''}${formatMinutes(walking.minutes)}${walking.metres!==null?`, ${formatDistance(walking.metres)} recorded`:''}. ${expanded?'Collapse':'Expand'} walks`} testID="recorded-walking-summary">
            <View style={styles.text}><Text style={type.body}>Walking</Text><Text style={type.detail}>{walkingCaption} · Health Connect</Text></View>
            <View style={styles.summaryValue}><Text style={styles.value}>{walking.uncertainTime?'≥ ':''}{formatMinutes(walking.minutes)}</Text>{walking.metres!==null&&<Text style={styles.tileValue}>{formatDistance(walking.metres)}{walking.partialDistance?' recorded':''}</Text>}</View><Text style={styles.chevron}>{expanded?'⌃':'⌄'}</Text>
          </Pressable>
          {expanded&&<View testID="recorded-walking-records">
            {(walking.overlap||walking.uncertainTime||walking.partialDistance)&&<Text style={styles.hint}>{walking.uncertainTime?'Incomplete timings: duration is a lower bound. ':''}Overlapping time is counted once. Only available, non-overlapping distance is added; no distance is estimated.</Text>}
            {[...walks].sort((a,b)=>(interval(a)?.[0]??0)-(interval(b)?.[0]??0)||a.id.localeCompare(b.id)).map(o=>row(o,true))}
          </View>}
        </View>}
        {remaining.map((o) => row(o))}
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
  const { colors, type } = useTheme();
  const styles = useStyles();
  const { fontScale } = useWindowDimensions();

  const o = p.observation;
  // Imported values belong to their source (Health Connect, #36): changed or deleted there, never here.
  const imported = o?.source.type === 'integration';
  const editable = p.editable && !imported;
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
        // Troubleshooting only (#44): the raw ID of an app Health Connect didn't name.
        sourcePackages(o.source.app).length ? ['App ID', sourcePackages(o.source.app).join(', ')] : null,
        o.source.evidence ? ['Read from', `“${o.source.evidence}”`] : null,
        o.source.confidence !== null ? ['Confidence', `${Math.round(o.source.confidence * 100)}%`] : null,
        o.source.capturedAt ? ['Captured', new Date(o.source.capturedAt).toLocaleString()] : null,
        ['Saved', new Date(o.recordedAt).toLocaleString()],
        o.activity ? ['Activity time', `${new Date(o.activity.start).toLocaleTimeString()}–${new Date(o.activity.end).toLocaleTimeString()}`] : null,
        o.activity?.distanceMeters !== undefined ? ['Distance', `${formatDistance(o.activity.distanceMeters)}${o.activity.distancePartial?' recorded (partial)':''}`] : null,
      ].filter((x): x is [string, string] => !!x)
    : [];
  return (
    <Sheet visible={!!o} onClose={p.onClose} label={o ? `${observationLabel(o)} details` : 'Details'}>
      {o && (
        <View style={styles.sheet}>
          <ModalHeader
            title={observationLabel(o)}
            dismiss={{ label: editable ? 'Cancel' : 'Close', onPress: p.onClose }}
            confirm={
              editable
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
          <ScrollView style={styles.detailScroll} contentContainerStyle={styles.sheetDetails}>
          {o.kind === 'inferred' && <Text style={[type.detail, styles.center]}>Calculated from other values, not measured.</Text>}
          {imported && (
            <Text style={[type.detail, styles.center]} testID="observation-imported-note">
              Imported from Health Connect. Change or delete it there. A value you enter yourself is kept and shown first.
            </Text>
          )}
          <View style={styles.inputRow}>
            <TextInput
              value={text}
              onChangeText={setText}
              editable={editable}
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
              <View key={k} style={[styles.fact, fontScale > 1.3 && styles.stackedFact]}>
                <Text style={[type.detail, styles.factKey, fontScale > 1.3 && styles.stackedFactKey]}>{k}</Text>
                <Text style={[type.detail, styles.factValue, fontScale > 1.3 && styles.stackedFactValue]}>{v}</Text>
              </View>
            ))}
          </View>
          {editable && (
            <Button
              title="Remove"
              variant="secondary"
              onPress={() => {
                p.onRemove(o);
                p.onClose();
              }}
            />
          )}
          </ScrollView>
        </View>
      )}
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  list: { marginTop: space.xs },
  grid: {flexDirection:'row',flexWrap:'wrap',gap:space.sm,marginBottom:space.sm},
  tile:{flex:1,flexBasis:96,minHeight:72,padding:space.sm,borderRadius:8,backgroundColor:colors.surface,gap:space.xs},
  tileValue:{fontSize:15,fontWeight:'700',color:colors.ink,fontVariant:['tabular-nums']},
  hint:{fontSize:12,lineHeight:18,color:colors.muted,marginBottom:space.xs},
  walkSummary:{minHeight:64,flexDirection:'row',alignItems:'center',gap:space.sm,paddingVertical:space.sm},
  walkRow:{minHeight:56,paddingVertical:space.sm,gap:space.sm},
  wrappingValue:{flexShrink:1,maxWidth:'44%',fontSize:15},
  summaryValue:{alignItems:'flex-end',flexShrink:1},
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
  sheet: { paddingBottom: space.md, gap: space.md, flexShrink:1 },
  detailScroll:{flexShrink:1},
  sheetDetails:{gap:space.md,paddingBottom:space.md},
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
  stackedFact: { flexDirection: 'column', gap: space.xs },
  stackedFactKey: { width: '100%' },
  stackedFactValue: { flex: 0 },
}));
