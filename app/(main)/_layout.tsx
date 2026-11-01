import { Slot } from 'expo-router';
import { AppShell } from '@/src/features/shell/AppShell';

/** Main screens render inside the app shell (persistent app bar + app menu, contract 02). Modal routes don't. */
export default function MainLayout() {
  return (
    <AppShell>
      <Slot />
    </AppShell>
  );
}
