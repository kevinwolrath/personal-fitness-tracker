import { act, fireEvent, screen } from '@testing-library/react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import seed from '../../../../plans/seed.plan.json';
import { planSchema } from '../../../plan/schema';
import { DataScreen, PlanGoalsScreen, PreferencesScreen, SettingsScreen } from '../SettingsScreens';

/**
 * #174: Settings is a real page with subpages on the stack. Back (the header's, or Android's, which pops the same
 * stack) goes up one level; a deep link straight to a subpage backs up to Settings.
 */
const mockPlan = planSchema.parse(seed);
jest.mock('../../../providers/AppProvider', () => ({ useApp: () => ({ plan: mockPlan, energy: 'kJ', setEnergy: jest.fn(), store: { snapshot: jest.fn() } }) }));
jest.mock('../../reminders/RemindersProvider', () => ({ useReminders: () => ({ enabled: false, permission: 'undetermined', today: [], planHasReminders: true }) }));
jest.mock('../../../platform/preferences', () => ({ preferences: { trendAlerts: jest.fn(async () => true), setTrendAlerts: jest.fn(async () => undefined) } }));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
let app: ReturnType<typeof renderRouter>;
const path = () => app.getPathname();
const launch = (initialUrl: string) =>
  (app = renderRouter(
    {
      _layout: () => (
        <SafeAreaProvider initialMetrics={metrics}>
          <Stack screenOptions={{ headerShown: false }} />
        </SafeAreaProvider>
      ),
      index: () => <Text testID="today">today</Text>,
      configure: () => <Text testID="configure-route">configure</Text>,
      setup: () => <Text testID="setup-route">setup</Text>,
      'settings/index': SettingsScreen,
      'settings/plan': PlanGoalsScreen,
      'settings/preferences': PreferencesScreen,
      'settings/data': DataScreen,
    },
    { initialUrl },
  ));

it('the landing page has the five sections, each reachable, and Back pops one level at a time', async () => {
  launch('/settings');
  expect(await screen.findByTestId('settings-screen')).toBeTruthy();
  for (const label of ['Plan & goals', 'My Gym', 'Reminders', 'App preferences', 'Data management']) expect(screen.getByLabelText(label)).toBeTruthy();

  fireEvent.press(screen.getByLabelText('Plan & goals'));
  expect(await screen.findByTestId('plan-summary')).toHaveTextContent(mockPlan.title, { exact: false });
  expect(path()).toBe('/settings/plan');
  fireEvent.press(screen.getByLabelText('Configure with AI'));
  expect(await screen.findByTestId('configure-route')).toBeTruthy();
  act(() => { require('expo-router').router.back(); });
  expect(path()).toBe('/settings/plan');
  fireEvent.press(screen.getByLabelText('Back from Plan & goals'));
  expect(path()).toBe('/settings');

  fireEvent.press(screen.getByLabelText('App preferences'));
  expect(await screen.findByTestId('app-preferences')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Back from App preferences'));
  expect(path()).toBe('/settings');

  fireEvent.press(screen.getByLabelText('Data management'));
  for (const label of ['Back up data', 'Restore data', 'Export all data']) expect(await screen.findByLabelText(label)).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Back from Data management'));
  expect(path()).toBe('/settings');
});

it('a deep link straight to a subpage backs up to Settings, then to Today', async () => {
  launch('/settings/data');
  expect(await screen.findByTestId('settings-data-screen')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Back from Data management'));
  expect(await screen.findByTestId('settings-screen')).toBeTruthy();
  expect(path()).toBe('/settings');
  fireEvent.press(screen.getByLabelText('Back from Settings'));
  expect(await screen.findByTestId('today')).toBeTruthy();
});

it('Reminders opens the existing sheet over Settings; closing it stays on Settings', async () => {
  launch('/settings');
  fireEvent.press(await screen.findByLabelText('Reminders'));
  expect(await screen.findByText('Turn on reminders')).toBeTruthy();
  const dismissers = screen.getAllByTestId('modal-dismiss');
  fireEvent.press(dismissers[dismissers.length - 1]);
  expect(screen.queryByText('Turn on reminders')).toBeNull();
  expect(path()).toBe('/settings');
});
