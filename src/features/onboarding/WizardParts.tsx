import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../ui/Button';
import { colors, radius, space, touch, type } from '../../ui/theme';

/**
 * The setup wizard's layout (#49, option A): screen header (step, progress, Skip), a content region that scrolls
 * only when it must, and a fixed bottom bar with Back and one primary action.
 */
export function WizardFrame(props: {
  step: number;
  total: number;
  title: string;
  sub: string;
  onSkip?: () => void;
  onBack?: () => void;
  /** "Cancel" when Back leaves the wizard (Edit setup answers, first step). */
  backLabel?: string;
  /** Fixed controls between the header and the scrolling content (the review's tabs). */
  above?: ReactNode;
  primary: { title: string; onPress: () => void; disabled?: boolean };
  children: ReactNode;
  testID: string;
}) {
  const { step, total, title, sub, onSkip, onBack, backLabel = 'Back', above, primary, children, testID } = props;
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']} testID={testID}>
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <Text style={styles.stepText} testID="setup-step">{`Step ${step} of ${total}`}</Text>
          {onSkip ? (
            <Pressable onPress={onSkip} style={styles.skip} accessibilityRole="button" accessibilityLabel="Skip this step" testID="setup-skip">
              <Text style={styles.link}>Skip</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: step }}>
          <View style={[styles.fill, { width: `${(step / total) * 100}%` }]} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.sub}>{sub}</Text>
      </View>
      {above ? <View style={styles.above}>{above}</View> : null}
      {/* Keyed by screen: each step starts at the top instead of keeping the previous step's scroll position. */}
      <ScrollView key={testID} style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" testID="setup-scroll">
        {children}
      </ScrollView>
      <View style={styles.bar}>
        <View style={styles.back}>
          <Button title={backLabel} variant="secondary" onPress={onBack} disabled={!onBack} accessibilityLabel={backLabel} />
        </View>
        <View style={styles.flex}>
          <Button title={primary.title} onPress={primary.onPress} disabled={primary.disabled} testID="setup-primary" />
        </View>
      </View>
    </SafeAreaView>
  );
}

export function Question({ label, children, testID }: { label: string; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.question} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      <Text style={type.section}>{label}</Text>
      {children}
    </View>
  );
}

/** A pill choice. `multi`: a checkbox (several may be on); otherwise a radio. */
export function Chip({ label, selected, onPress, multi, testID, wide }: { label: string; selected: boolean; onPress: () => void; multi?: boolean; testID?: string; wide?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, wide && styles.chipWide, selected && styles.selected, pressed && styles.pressed]}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={multi ? { checked: selected } : { selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={label}
      testID={testID}
    >
      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

export const Chips = ({ children }: { children: ReactNode }) => <View style={styles.chips}>{children}</View>;
export const Grid = ({ children }: { children: ReactNode }) => <View style={styles.grid}>{children}</View>;

export function TextLink({ title, onPress, testID, label }: { title: string; onPress: () => void; testID?: string; label?: string }) {
  return (
    <Pressable onPress={onPress} style={styles.textLink} accessibilityRole="button" accessibilityLabel={label ?? title} testID={testID}>
      <Text style={styles.link}>{title}</Text>
    </Pressable>
  );
}

export function Card({ title, children, testID }: { title: string; children: ReactNode; testID?: string }) {
  return (
    <View style={styles.card} testID={testID}>
      <Text style={type.section}>{title}</Text>
      {children}
    </View>
  );
}

export const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.xs },
  headerRow: { minHeight: touch, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepText: { fontSize: 15, color: colors.muted },
  skip: { minHeight: touch, minWidth: touch, alignItems: 'flex-end', justifyContent: 'center' },
  link: { fontSize: 16, fontWeight: '700', color: colors.accent },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  title: { ...type.title, fontSize: 28, marginTop: space.md },
  sub: { fontSize: 15, color: colors.muted, lineHeight: 21 },
  content: { paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xl, gap: space.lg },
  bar: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.md, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg },
  back: { minWidth: 96 },
  question: { gap: space.sm },
  above: { paddingHorizontal: space.xl, paddingTop: space.md, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: touch, minWidth: touch, paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  chipWide: { flexBasis: '47%', flexGrow: 1, borderRadius: radius.md },
  selected: { borderWidth: 2, borderColor: colors.accent, backgroundColor: colors.accentSoft },
  pressed: { opacity: 0.75 },
  chipText: { fontSize: 16, fontWeight: '600', color: colors.ink },
  chipTextOn: { fontWeight: '700' },
  textLink: { minHeight: touch, justifyContent: 'center', alignSelf: 'flex-start' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm },
  hint: { fontSize: 13, color: colors.muted, lineHeight: 18 },
});
