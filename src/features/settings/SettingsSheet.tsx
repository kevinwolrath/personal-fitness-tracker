import { Pressable, StyleSheet, Text, View } from 'react-native';
import { energyDisplays, formatEnergy, type EnergyDisplay } from '../../energy';
import { useApp } from '../../providers/AppProvider';
import { ModalHeader } from '../../ui/ModalHeader';
import { Sheet } from '../../ui/Sheet';
import { colors, space, type } from '../../ui/theme';

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
  const { energy, setEnergy } = useApp();
  return (
    <Sheet visible={visible} onClose={onClose} label="Settings">
      <ModalHeader title="Settings" dismiss={{ label: 'Close', onPress: onClose }} />
      <View style={styles.body} testID="settings-sheet">
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
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
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
});
