import { Pressable, StyleSheet, Text, View } from 'react-native';
import { addDays, type LocalDate } from '../../plan/dates';
import { DateField } from '../../ui/DateField';
import { Sheet } from '../../ui/Sheet';
import { colors, radius, space, touch } from '../../ui/theme';
import { dayLabels } from './dayLabels';
import { SheetHeader, TextButton } from './Sheets';

type Props = {
  visible: boolean;
  date: LocalDate;
  today: LocalDate;
  /** Earliest date with any record, for the "First entry" shortcut. */
  firstRecord: LocalDate | null;
  onClose: () => void;
  onJump: (date: LocalDate) => void;
};

/** Jump straight to any date in the Daily Log (contract 02): shortcuts plus the platform date picker. */
export function JumpToDateSheet(p: Props) {
  const go = (d: LocalDate) => {
    p.onJump(d);
    p.onClose();
  };
  const shortcuts: { label: string; date: LocalDate }[] = [
    { label: 'Today', date: p.today },
    { label: 'Yesterday', date: addDays(p.today, -1) },
    { label: 'A week ago', date: addDays(p.today, -7) },
    ...(p.firstRecord && p.firstRecord < addDays(p.today, -7) ? [{ label: 'First entry', date: p.firstRecord }] : []),
  ];
  return (
    <Sheet visible={p.visible} onClose={p.onClose} label="Jump to a date">
      <View style={styles.body}>
        <SheetHeader title="Go to date" right={<TextButton title="Close" onPress={p.onClose} />} />
        <View style={styles.chips}>
          {shortcuts.map((s) => (
            <Pressable
              key={s.label}
              onPress={() => go(s.date)}
              style={[styles.chip, s.date === p.date && styles.chipOn]}
              accessibilityRole="button"
              accessibilityLabel={s.label === 'First entry' ? `First entry, ${dayLabels(s.date, p.today).date}` : s.label}
            >
              <Text style={[styles.chipText, s.date === p.date && styles.chipTextOn]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>
        <DateField value={p.date} onChange={go} label="Choose a date" />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: space.md, gap: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: touch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.ink },
  chipTextOn: { color: colors.onAccent },
});
