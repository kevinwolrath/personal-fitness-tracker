import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { colors, radius, space, touch } from './theme';

type Props = Omit<PressableProps, 'children' | 'style'> & { title: string; variant?: 'primary' | 'secondary' | 'quiet' };

export function Button({ title, variant = 'primary', disabled, ...rest }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, disabled && styles.disabled]}
      {...rest}
    >
      <Text style={[styles.text, variant === 'primary' ? styles.onPrimary : styles.onOther]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { minHeight: touch + 8, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  primary: { backgroundColor: colors.ink },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  quiet: { backgroundColor: 'transparent' },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  text: { fontSize: 17, fontWeight: '700' },
  onPrimary: { color: colors.onAccent },
  onOther: { color: colors.ink },
});
