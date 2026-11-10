import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import type { MuscleGrowthRow } from '../../exercises/catalogue';
import { Button } from '../../ui/Button';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { Sheet } from '../../ui/Sheet';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';

export type GrowthDetails = { sets: number; reps?: number; seconds?: number; loadKg?: number; rir?: number };

/**
 * What was actually done for one Muscle Growth item (#122): sets, reps (or seconds), load and reps in reserve. Saving
 * replaces that date's record for the movement, so a correction never adds a second log. Nothing is suggested here.
 */
export function MuscleGrowthLogSheet({ row, onSave, onClose }: { row: MuscleGrowthRow; onSave: (d: GrowthDetails) => void; onClose: () => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();
  const src = row.log && row.status === 'done' ? { sets: row.log.sets, reps: row.log.reps ?? undefined, seconds: row.log.seconds ?? undefined, loadKg: row.log.loadKg ?? undefined, rir: row.log.rir ?? undefined } : row.planned;
  const timed = src.seconds !== undefined && src.reps === undefined;
  const [sets, setSets] = useState(String(src.sets));
  const [amount, setAmount] = useState(String(timed ? src.seconds : src.reps ?? ''));
  const [load, setLoad] = useState(src.loadKg !== undefined ? String(src.loadKg) : '');
  const [rir, setRir] = useState('rir' in src && src.rir !== undefined ? String(src.rir) : '');
  const n = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(',', '.')));
  const setsN = n(sets), amountN = n(amount), loadN = n(load), rirN = n(rir);
  const valid =
    setsN !== undefined && Number.isInteger(setsN) && setsN >= 1 && setsN <= 20 &&
    amountN !== undefined && amountN > 0 && (timed || Number.isInteger(amountN)) &&
    (loadN === undefined || (loadN > 0 && loadN <= 500)) &&
    (rirN === undefined || (Number.isInteger(rirN) && rirN >= 0 && rirN <= 10));
  const field = (labelText: string, value: string, set: (s: string) => void, testID: string, decimal = false) => (
    <View style={styles.field}>
      <Text style={type.detail}>{labelText}</Text>
      <TextInput value={value} onChangeText={set} keyboardType={decimal ? 'decimal-pad' : 'number-pad'} style={styles.input} accessibilityLabel={labelText} placeholderTextColor={colors.faint} testID={testID} />
    </View>
  );
  return (
    <Sheet visible onClose={onClose} label={`${row.name}: what you did`}>
      <ModalHeader title={row.name} dismiss={{ label: 'Cancel', a11yLabel: 'Cancel log details', onPress: onClose }} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="mg-log-sheet">
        <Text style={type.detail}>What you actually did. Saving replaces this day's record for {row.name}; it never adds a second one.</Text>
        <View style={styles.grid}>
          {field('Sets', sets, setSets, 'mg-log-sets')}
          {field(timed ? 'Seconds per set' : 'Reps per set', amount, setAmount, 'mg-log-amount')}
          {field('Load (kg, optional)', load, setLoad, 'mg-log-load', true)}
          {field('Reps in reserve (0–10, optional)', rir, setRir, 'mg-log-rir')}
        </View>
        <Button
          title="Save"
          disabled={!valid}
          testID="mg-log-save"
          onPress={() => onSave({ sets: setsN!, ...(timed ? { seconds: amountN } : { reps: amountN }), ...(loadN !== undefined ? { loadKg: loadN } : {}), ...(rirN !== undefined ? { rir: rirN } : {}) })}
        />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  content: { gap: space.md, paddingBottom: space.xl },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: { flexBasis: '47%', flexGrow: 1, gap: space.xs },
  input: { minHeight: touch, padding: space.md, color: colors.ink, backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, fontSize: 17 },
}));
