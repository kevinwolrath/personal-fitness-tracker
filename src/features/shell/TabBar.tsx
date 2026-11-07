import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path, Rect } from 'react-native-svg';
import { space, touch, useTheme, createThemedStyles } from '../../ui/theme';

/**
 * The bottom tab bar (contract 02, app shell layer): Today and Progress (#52). It arrived with the second tab.
 * Rendered by the shell, never by a screen; respects the bottom safe area.
 */
const tabs = [
  { href: '/', label: 'Today', icon: (c: string) => (
    <Svg width={22} height={22} viewBox="0 0 22 22" aria-hidden>
      <Rect x={3} y={4} width={16} height={15} rx={3} fill="none" stroke={c} strokeWidth={2} />
      <Path d="M3 9h16M8 2v4M14 2v4" stroke={c} strokeWidth={2} />
    </Svg>
  ) },
  { href: '/progress', label: 'Progress', icon: (c: string) => (
    <Svg width={22} height={22} viewBox="0 0 22 22" aria-hidden>
      <Path d="M3 17l5-6 4 3 7-9" fill="none" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  ) },
] as const;

export function TabBar() {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const path = usePathname();
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={styles.bar} testID="tab-bar">
      <View style={styles.row} accessibilityRole="tablist">
        {tabs.map((t) => {
          const on = t.href === '/' ? path === '/' : path.startsWith(t.href);
          const c = on ? colors.accent : colors.muted;
          return (
            <Pressable
              key={t.href}
              onPress={() => !on && router.navigate(t.href)}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              aria-selected={on}
              accessibilityLabel={t.label}
              testID={`tab-${t.label.toLowerCase()}`}
            >
              {t.icon(c)}
              <Text style={[styles.label, { color: c }, on && styles.labelOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  bar: { backgroundColor: colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  row: { flexDirection: 'row', height: touch + 8 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, paddingVertical: space.xs },
  label: { fontSize: 12, fontWeight: '600' },
  labelOn: { fontWeight: '800' },
}));
