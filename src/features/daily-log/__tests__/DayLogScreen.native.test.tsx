/**
 * Renders the real Today screen with the iOS and Android RN presets (see jest "projects"),
 * exercising native code paths (native Sheet/Modal, no web adapters).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Slot } from 'expo-router';
import { Platform } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MemoryKeyValue } from '../../../storage/keyValueStore';
import { AppProvider } from '../../../providers/AppProvider';
import { DayLogScreen } from '../DayLogScreen';

// One in-memory backend per test; a new store over it simulates an app restart.
let mockKv = new MemoryKeyValue();
jest.mock('../../../storage/openStore', () => ({
  openStore: async () => {
    const { KeyValueTrackingStore: Store } = jest.requireActual('../../../storage/keyValueStore');
    return new Store(mockKv);
  },
}));

const NOW = new Date(2026, 10, 5, 9, 0); // Thursday 5 Nov, local time
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function launch() {
  const utils = renderRouter(
    {
      _layout: () => (
        <SafeAreaProvider initialMetrics={metrics}>
          <AppProvider>
            <Slot />
          </AppProvider>
        </SafeAreaProvider>
      ),
      index: DayLogScreen,
    },
    { initialUrl: '/' },
  );
  // renderRouter re-installs fake timers (resetting the clock); Today mounts after the store loads, so re-pin now.
  jest.setSystemTime(NOW);
  await screen.findByTestId('day-progress');
  return utils;
}

beforeEach(() => {
  mockKv = new MemoryKeyValue();
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => jest.useRealTimers());

it('resolves Thursday from the seed plan', async () => {
  await launch();
  expect(screen.getByLabelText(/Day type: Office day/)).toBeTruthy();
  expect(screen.getByTestId('activity-lunch-walk')).toBeTruthy();
  expect(screen.queryByTestId('activity-school-run-am')).toBeNull();
  expect(screen.getByTestId('day-progress')).toHaveTextContent('0 of 5 done');
});

it('completes, skips via the native sheet, and survives a restart', async () => {
  const first = await launch();
  fireEvent.press(screen.getByLabelText(/, Fixed lunch$/)); // the row (the card's button is "Done: Fixed lunch")
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done'));

  // Conditioning is one requirement (VR boxing / heavy bag / battle ropes): skipped as a unit.
  fireEvent.press(screen.getByLabelText('High-intensity conditioning details'));
  fireEvent.press(await screen.findByText('Skip'));
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 4 done'));

  fireEvent.press(screen.getByLabelText("I'm hungry"));
  await waitFor(() => expect(screen.getByTestId('quick-log-summary')).toHaveTextContent(/I'm hungry: 9:00/i));

  first.unmount();
  await act(async () => {});
  await launch();
  expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 4 done');
  expect(screen.getByTestId('requirement-hard-conditioning')).toHaveTextContent(/Skipped/);
  expect(screen.getByTestId('quick-log-summary')).toHaveTextContent(/I'm hungry: 9:00/i);
});

it('is one continuous log: step back, jump via the date sheet, return to Today', async () => {
  await launch();
  expect(screen.getByTestId('day-title')).toHaveTextContent('Today');

  fireEvent.press(screen.getByLabelText('Previous day'));
  await waitFor(() => expect(screen.getByTestId('day-title')).toHaveTextContent('Yesterday'));
  expect(screen.getByLabelText(/Day type: Home day/)).toBeTruthy(); // Wed 4 Nov resolves from the plan

  fireEvent.press(screen.getByTestId('date-button'));
  // iOS: inline calendar in the sheet. Android: a button that opens the system date dialog.
  if (Platform.OS === 'ios') expect(await screen.findByTestId('native-date-picker')).toBeTruthy();
  else expect(await screen.findByText('Choose a date')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('A week ago'));
  await waitFor(() => expect(screen.getByTestId('day-title')).toHaveTextContent(/October 29|29 October/)); // 7 days back: a date, not a weekday

  fireEvent.press(screen.getByLabelText('Back to Today'));
  await waitFor(() => expect(screen.getByTestId('day-title')).toHaveTextContent('Today'));
});

it('shows the next action and ticks it off from the card (native)', async () => {
  await launch();
  // Thursday 09:00, office day: nothing due yet and no anytime work, so the earliest item is next.
  expect(screen.getByTestId('next-action-title')).toHaveTextContent('Fixed lunch');
  expect(screen.getByTestId('next-action-when')).toHaveTextContent(/Next up at 12:00/i);
  fireEvent.press(screen.getByLabelText('Done: Fixed lunch'));
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done'));
  await waitFor(() => expect(screen.getByTestId('next-action-title')).toHaveTextContent('Lunch walk'));
});
