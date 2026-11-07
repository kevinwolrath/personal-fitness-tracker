import { Pressable, StyleSheet, Text, type PressableProps } from 'react-native';
import { radius, space, touch, useTheme, createThemedStyles } from './theme';

type Props = Omit<PressableProps, 'children' | 'style'> & { title: string; variant?: 'primary' | 'secondary' | 'quiet' | 'inverse' };

export function Button({ title, variant = 'primary', disabled, ...rest }: Props) {
  const { dark } = useTheme();
  const styles = useStyles();

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      style={({ pressed }) => [styles.base, styles[variant], pressed && styles.pressed, disabled && styles.disabled]}
      // data-variant on web: tests count primary buttons per surface (contract 01, one primary action).
      {...({ dataSet: { variant } } as object)}
      {...rest}
    >
      <Text style={[styles.text, variant === 'primary' || (variant === 'inverse' && dark) ? styles.onPrimary : styles.onOther]}>{title}</Text>
    </Pressable>
  );
}

const useStyles = createThemedStyles(({ colors, dark }) => ({
  base: { minHeight: touch + 8, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  quiet: { backgroundColor: 'transparent' },
  /** Primary action on an ink surface. */
  inverse: { backgroundColor: dark ? colors.primary : colors.surface },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  text: { fontSize: 17, fontWeight: '700' },
  onPrimary: { color: colors.onAccent },
  onOther: { color: colors.ink },
}));
