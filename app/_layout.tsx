import { ThemeProvider } from '@/src/ui/ThemeProvider';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import { APP_NAME } from '@/src/brand';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '@/src/providers/AppProvider';
import { PhoneFrame } from '@/src/ui/PhoneFrame';
import { useTheme } from '@/src/ui/theme';
import { ScrollIndicators } from '@/src/ui/ScrollIndicators';
import * as SplashScreen from 'expo-splash-screen';
import { Platform } from 'react-native';
import { useRestoreEpoch } from '@/src/backup/restored';
import { RemindersProvider } from '@/src/features/reminders/RemindersProvider';

if (Platform.OS !== 'web') SplashScreen.preventAutoHideAsync().catch(() => undefined);

function ThemedApp() {
  const { colors, dark } = useTheme();

  return (
    <SafeAreaProvider>
      <ScrollIndicators />
      <Head><title>{APP_NAME}</title></Head>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <PhoneFrame>
        <AppProvider>
          {/* Reminders serve the shell and Settings (#174), so they sit above the stack. */}
          <RemindersProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(main)" />
            <Stack.Screen name="configure" options={{ presentation: 'modal' }} />
            <Stack.Screen name="meal-photo" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="meal-return" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="setup" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="settings/index" />
            <Stack.Screen name="settings/plan" />
            <Stack.Screen name="settings/preferences" />
            <Stack.Screen name="settings/data" />
          </Stack>
          </RemindersProvider>
        </AppProvider>
      </PhoneFrame>
    </SafeAreaProvider>
  );
}

/** A full restore (#128) remounts the whole app (store, theme and every provider) on the restored data. */
export default function RootLayout() {
  const epoch = useRestoreEpoch();
  return <ThemeProvider key={epoch}><ThemedApp /></ThemeProvider>;
}
