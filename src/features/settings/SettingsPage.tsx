import { router, type Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ModalHeader } from '../../ui/ModalHeader';
import { ScrollView } from '../../ui/ScrollView';
import { space, touch, useTheme, createThemedStyles } from '../../ui/theme';

/**
 * Back one level (#174): pop the stack when there is somewhere to go back to, else (a deep link straight to this page)
 * go to `fallback`, the page above it. Android's back button pops the same stack.
 */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}

/**
 * A Settings page (#174, contract 02): a full-screen stack route outside the main shell, with the one header
 * (‹ Back, title) and scrolling content. Sheets opened from it present over it and close back to it.
 */
export function SettingsPage({ title, back, children, testID, footer }: { title: string; back: Href; children: ReactNode; testID: string; footer?: ReactNode }) {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID={testID}>
      <View style={styles.pad}>
        <ModalHeader title={title} dismiss={{ label: 'Back', a11yLabel: `Back from ${title}`, onPress: () => goBack(back) }} titleTestID="settings-title" />
      </View>
      <ScrollView contentContainerStyle={styles.body} testID={`${testID}-scroll`}>
        {children}
      </ScrollView>
      {footer}
    </SafeAreaView>
  );
}

/** One navigable row: label, a detail line, and a chevron. The same size and spacing as the app menu's rows. */
export function SettingsRow({ label, detail, onPress, testID }: { label: string; detail: string; onPress: () => void; testID: string }) {
  const { type, colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} testID={testID}>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={type.detail}>{detail}</Text>
      </View>
      <Text style={[styles.chevron, { color: colors.muted }]} aria-hidden>›</Text>
    </Pressable>
  );
}

/** A small section label above a group of rows. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const { type } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.section}>
      <Text style={type.section} accessibilityRole="header">{title}</Text>
      <View>{children}</View>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  safe: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: space.xl },
  body: { paddingHorizontal: space.xl, paddingBottom: space.xxl, gap: space.lg },
  section: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touch + 12, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  pressed: { opacity: 0.6 },
  text: { flex: 1, gap: 2 },
  label: { fontSize: 17, fontWeight: '700', color: colors.ink },
  chevron: { fontSize: 26, fontWeight: '400' },
}));
