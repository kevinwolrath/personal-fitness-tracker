import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { RestOfDay } from '../../nutrition/restOfDay';
import { createThemedStyles, radius, space, touch, useTheme } from '../../ui/theme';

/**
 * "Rest of today" (#99): optional suggestions after a logged meal. "Keep the plan" always comes first; the rest are
 * options, never a prescription. The explanation (what's eaten, planned and the limit) expands on request.
 */
export function RestOfDayCard({ model }: { model: RestOfDay }) {
  const styles = useStyles();
  const { type } = useTheme();
  const [open, setOpen] = useState(false);
  if (!model.show) return null;
  return (
    <View style={styles.card} testID="rest-of-day" accessibilityLiveRegion="polite">
      <Text style={styles.eyebrow}>Rest of today</Text>
      <Text style={styles.title} testID="rest-of-day-headline">{model.headline}</Text>
      {model.suggestions.map((s) => (
        <View key={s.id} style={styles.row} testID={`rest-of-day-${s.kind}`}>
          <Text style={styles.name}>{s.title}</Text>
          {s.detail ? <Text style={type.detail}>{s.detail}</Text> : null}
        </View>
      ))}
      {model.explanation.length > 0 && (
        <Pressable onPress={() => setOpen((o) => !o)} style={styles.link} accessibilityRole="button" accessibilityState={{ expanded: open }} testID="rest-of-day-why">
          <Text style={styles.linkText}>{open ? 'Why ⌃' : 'Why ⌄'}</Text>
        </Pressable>
      )}
      {open && (
        <View testID="rest-of-day-explanation">
          {model.explanation.map((l) => <Text key={l} style={type.detail}>{l}</Text>)}
        </View>
      )}
      <Text style={[type.detail, styles.note]}>Suggestions only. Nothing changes in your plan unless you change it.</Text>
    </View>
  );
}

const useStyles = createThemedStyles(({ colors }) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, gap: space.xs, borderWidth: 1, borderColor: colors.line },
  eyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', color: colors.accent },
  title: { fontSize: 18, fontWeight: '800', color: colors.ink },
  row: { gap: 2, paddingTop: space.xs },
  name: { fontSize: 15, fontWeight: '700', color: colors.ink },
  link: { minHeight: touch, justifyContent: 'center' },
  linkText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  note: { marginTop: space.xs },
}));
