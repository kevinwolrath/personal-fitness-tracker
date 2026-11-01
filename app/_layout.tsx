import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '@/src/providers/AppProvider';
import { PhoneFrame } from '@/src/ui/PhoneFrame';
import { colors } from '@/src/ui/theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <PhoneFrame>
        <AppProvider>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
            <Stack.Screen name="(main)" />
            <Stack.Screen name="import" options={{ presentation: 'modal' }} />
            <Stack.Screen name="configure" options={{ presentation: 'modal' }} />
          </Stack>
        </AppProvider>
      </PhoneFrame>
    </SafeAreaProvider>
  );
}
