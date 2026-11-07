import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { draftFromProfile } from '../../onboarding/draft';
import { useApp } from '../../providers/AppProvider';
import type { StoredPlan } from '../../storage/types';
import { useTheme, createThemedStyles } from '../../ui/theme';
import { SetupWizard } from './SetupWizard';

/**
 * Edit setup answers (#53): the setup wizard over the current plan, as a full-screen route. Starts from the
 * plan's saved answers and replaces the plan only after the user confirms; history is kept (contract 13).
 */
export function EditSetupScreen() {
  const { colors, type } = useTheme();
  const styles = useStyles();

  const { store, plan, energy, reloadPlan } = useApp();
  const [current, setCurrent] = useState<StoredPlan | null>(null);
  useEffect(() => {
    store.getActivePlan().then(setCurrent);
  }, [store]);
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  if (!current) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.muted} />
      </View>
    );
  }
  return (
    <SetupWizard
      store={store}
      energy={energy}
      edit={{ current, initial: draftFromProfile(plan.profile, plan.units.mass), onCancel: close }}
      onFinished={async () => {
        await reloadPlan();
        close();
      }}
    />
  );
}

const useStyles = createThemedStyles(({ colors, type }) => ({ center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg } }));
