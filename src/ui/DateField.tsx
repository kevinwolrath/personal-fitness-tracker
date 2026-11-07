import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Platform, StyleSheet, View } from 'react-native';
import { parseLocalDate, toLocalDate, type LocalDate } from '../plan/dates';
import { Button } from './Button';
import { useTheme } from './theme';

type Props = { value: LocalDate; onChange: (date: LocalDate) => void; label: string };

/**
 * Native date picker (contract 02 "jump to date"). iOS: inline calendar (month/year header jumps across years).
 * Android: the system calendar dialog (tap the year to jump years). See DateField.web.tsx.
 */
export function DateField({ value, onChange, label }: Props) {
  const { dark, colors } = useTheme();
  const handle = (e: DateTimePickerEvent, d?: Date) => {
    if (e.type === 'set' && d) onChange(toLocalDate(d));
  };
  if (Platform.OS === 'android') {
    return (
      <Button
        title={label}
        variant="secondary"
        onPress={() => DateTimePickerAndroid.open({ value: parseLocalDate(value), mode: 'date', onChange: handle })}
      />
    );
  }
  return (
    <View style={styles.inline} accessibilityLabel={label}>
      <DateTimePicker themeVariant={dark ? 'dark' : 'light'} accentColor={colors.accent} value={parseLocalDate(value)} mode="date" display="inline" onChange={(e, d) => d && onChange(toLocalDate(d))} />
    </View>
  );
}

const styles = StyleSheet.create({ inline: { alignItems: 'center' } });
