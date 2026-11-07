import { Pressable, StyleSheet, Text, View } from 'react-native';
import { radius, space, touch, useTheme, createThemedStyles } from '../../ui/theme';

/**
 * Today with no plan yet (#49: setup skipped the AI step). A quiet card in the "Do this next" slot: weight
 * tracking works now, and a plan can be set up with AI whenever the user wants. Under 18: tracking only.
 */
export function NoPlanCard({ minor, onSetUp }: { minor: boolean; onSetUp: () => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  return (
    <View style={styles.card} testID="no-plan">
      <Text style={styles.title} accessibilityRole="header">
        {minor ? 'Tracking only' : 'No plan yet'}
      </Text>
      <Text style={type.detail}>{minor ? 'Log your weight and anything you do.' : 'Weight tracking is ready. Add workouts and habits whenever you like.'}</Text>
      {minor ? null : (
        <Pressable onPress={onSetUp} style={styles.link} accessibilityRole="button" accessibilityLabel="Set up a plan with AI" testID="no-plan-set-up">
          <Text style={styles.linkText}>Set up a plan with AI</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, gap: space.xs },
  title: { fontSize: 19, fontWeight: '800', color: colors.ink },
  link: { minHeight: touch, justifyContent: 'center', alignSelf: 'flex-start' },
  linkText: { fontSize: 16, fontWeight: '700', color: colors.accent },
}));
