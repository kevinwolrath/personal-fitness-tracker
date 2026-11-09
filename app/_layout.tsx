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
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(main)" />
            <Stack.Screen name="import" options={{ presentation: 'modal' }} />
            <Stack.Screen name="configure" options={{ presentation: 'modal' }} />
            <Stack.Screen name="meal-photo" options={{ presentation: 'fullScreenModal' }} />
            <Stack.Screen name="setup" options={{ presentation: 'fullScreenModal' }} />
          </Stack>
        </AppProvider>
      </PhoneFrame>
    </SafeAreaProvider>
  );
}

export default function RootLayout() { return <ThemeProvider><ThemedApp /></ThemeProvider>; }
