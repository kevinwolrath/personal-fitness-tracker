import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from '../../ui/ScrollView';
import { themes } from '../../ui/theme';
import { energyDisplays, formatEnergy, type EnergyDisplay } from '../../energy';
import { useApp } from '../../providers/AppProvider';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { space, useTheme, createThemedStyles } from '../../ui/theme';

const choiceLabels: Record<EnergyDisplay, string> = {
  kJ: 'Kilojoules (kJ)',
  kcal: 'Calories (kcal)',
  both: 'Both',
};

/** The example under each choice: one fixed amount shown each way, so the difference is visible. */
const EXAMPLE_KJ = 1780;

/**
 * Settings (#39, contract 02 app shell): device preferences that are never plan data. For now, how energy is
 * shown. A choice applies immediately everywhere and is remembered; stored values never change.
 */
export function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { energy, setEnergy } = useApp();
  const { id: themeId, setTheme, saveError } = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} label="Settings">
      <ModalHeader title="Settings" dismiss={{ label: 'Close', onPress: onClose }} />
      <ScrollView contentContainerStyle={styles.body} testID="settings-sheet">
        <View role="radiogroup" aria-label="Appearance">
          <Text style={type.section}>Appearance</Text>
          {Object.values(themes).map(theme => (
            <Pressable key={theme.id} onPress={() => setTheme(theme.id)} style={styles.choice} role="radio" aria-label={theme.label} aria-checked={themeId === theme.id} testID={`theme-${theme.id}`}>
              <View style={[styles.radio, themeId === theme.id && styles.radioOn]}>{themeId === theme.id && <View style={styles.dot} />}</View>
              <Text style={styles.label}>{theme.label}</Text>
            </Pressable>
          ))}
          {saveError && <Text style={type.detail} accessibilityLiveRegion="polite">Applied for this session. Could not save appearance; choose it again to retry.</Text>}
        </View>
        <View role="radiogroup" aria-label="Energy units">
          <Text style={type.section} accessibilityRole="header">
            Energy units
          </Text>
          {energyDisplays.map((d) => {
            const selected = d === energy;
            return (
              <Pressable
                key={d}
                onPress={() => setEnergy(d)}
                style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
                role="radio"
                aria-checked={selected}
                aria-label={choiceLabels[d]}
                testID={`energy-${d}`}
              >
                <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.dot} />}</View>
                <View style={styles.text}>
                  <Text style={styles.label}>{choiceLabels[d]}</Text>
                  <Text style={type.detail}>{formatEnergy(EXAMPLE_KJ, 'kJ', d)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <Text style={type.detail}>
          Food “calories” are kilocalories (kcal). 1 kcal = 4.184 kJ. This only changes how energy is shown on this phone: your plan
          and your records stay as they are.
        </Text>
      </ScrollView>
    </Sheet>
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({
  body: { gap: space.md, paddingBottom: space.md },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  pressed: { opacity: 0.6 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.accent },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.accent },
  text: { flex: 1 },
  label: { fontSize: 17, fontWeight: '700', color: colors.ink },
}));
