import { useEffect, useState } from 'react';
import { preferences } from '../../platform/preferences';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GamificationSettings } from '../../gamification/Gamification';
import { themes } from '../../ui/theme';
import { energyDisplays, formatEnergy, type EnergyDisplay } from '../../energy';
import { useApp } from '../../providers/AppProvider';
import { space, useTheme, createThemedStyles } from '../../ui/theme';

const choiceLabels: Record<EnergyDisplay, string> = {
  kJ: 'Kilojoules (kJ)',
  kcal: 'Calories (kcal)',
  both: 'Both',
};

/** The example under each choice: one fixed amount shown each way, so the difference is visible. */
const EXAMPLE_KJ = 1780;

/**
 * App preferences (#39; a Settings subpage since #174, contract 02): device preferences that are never plan data:
 * Quests, appearance, how energy is shown and weight-trend alerts. A choice applies immediately everywhere and is
 * remembered; stored values never change.
 */
export function AppPreferences() {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { energy, setEnergy } = useApp();
  const { id: themeId, setTheme, saveError } = useTheme();
  return (
    <View style={styles.body} testID="app-preferences">
        <GamificationSettings />
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
        <TrendAlertsSetting />
    </View>
  );
}

/** #57: weight-trend alerts on or off (a device choice). */
function TrendAlertsSetting() {
  const { type } = useTheme();
  const styles = useStyles();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    preferences.trendAlerts().then(setOn, () => setOn(true));
  }, []);
  if (on === null) return null;
  const toggle = () => {
    setOn(!on);
    preferences.setTrendAlerts(!on).catch(() => undefined);
  };
  return (
    <View>
      <Text style={type.section} accessibilityRole="header">Weight trend alerts</Text>
      <Pressable onPress={toggle} style={({ pressed }) => [styles.choice, pressed && styles.pressed]} role="switch" aria-checked={on} aria-label="Weight trend alerts" testID="trend-alerts">
        <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.dot} />}</View>
        <View style={styles.text}>
          <Text style={styles.label}>{on ? 'On' : 'Off'}</Text>
          <Text style={type.detail}>A dot on Progress, and a notification if notifications are allowed, when your weight trend has been flat or slower for a few weeks. At most once a week.</Text>
        </View>
      </Pressable>
    </View>
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
