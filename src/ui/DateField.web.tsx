import { createElement } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { LocalDate } from '../plan/dates';
import { radius, space, touch, useTheme } from './theme';

type Props = { value: LocalDate; onChange: (date: LocalDate) => void; label: string };

/** Web (dev/test surface): the browser's native date input. */
export function DateField({ value, onChange, label }: Props) {
  const { colors, type } = useTheme();

  return (
    <View style={styles.wrap}>
      <Text style={type.section}>{label}</Text>
      {createElement('input', {
        type: 'date',
        value,
        'aria-label': label,
        onChange: (e: { target: { value: string } }) => /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && onChange(e.target.value),
        style: {
          minHeight: touch,
          fontSize: 17,
          padding: `0 ${space.md}px`,
          borderRadius: radius.sm,
          border: `1px solid ${colors.line}`,
          color: colors.ink,
          background: colors.surface,
          fontFamily: 'inherit',
        },
      })}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: space.sm } });
