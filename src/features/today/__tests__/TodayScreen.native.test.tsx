/**
 * Renders the real Today screen with the iOS and Android RN presets (see jest "projects"),
 * exercising native code paths (native Sheet/Modal, no web adapters).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MemoryKeyValue } from '../../../storage/keyValueStore';
import { AppProvider } from '../../../providers/AppProvider';
import { TodayScreen } from '../TodayScreen';

// One in-memory backend per test; a new store over it simulates an app restart.
let mockKv = new MemoryKeyValue();
jest.mock('../../../storage/openStore', () => ({
  openStore: async () => {
    const { KeyValueTrackingStore: Store } = jest.requireActual('../../../storage/keyValueStore');
    return new Store(mockKv);
  },
}));

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

async function launch() {
  const utils = render(
    <SafeAreaProvider initialMetrics={metrics}>
      <AppProvider>
        <TodayScreen />
      </AppProvider>
    </SafeAreaProvider>,
  );
  await screen.findByTestId('day-progress');
  return utils;
}

beforeEach(() => {
  mockKv = new MemoryKeyValue();
  jest.useFakeTimers({ now: new Date(2026, 10, 5, 9, 0) }); // Thursday 5 Nov, local time
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
  fireEvent.press(screen.getByLabelText(/Fixed lunch$/));
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done'));

  fireEvent.press(screen.getByLabelText('VR boxing details'));
  fireEvent.press(await screen.findByText('Skip'));
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 4 done'));

  fireEvent.press(screen.getByLabelText("I'm hungry"));
  await waitFor(() => expect(screen.getByTestId('quick-log-summary')).toHaveTextContent(/I'm hungry: 9:00/i));

  first.unmount();
  await act(async () => {});
  await launch();
  expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 4 done');
  expect(screen.getByTestId('activity-vr-boxing')).toHaveTextContent(/Skipped/);
  expect(screen.getByTestId('quick-log-summary')).toHaveTextContent(/I'm hungry: 9:00/i);
});
