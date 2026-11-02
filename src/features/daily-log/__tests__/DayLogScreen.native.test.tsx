/**
 * Renders the real Today screen with the iOS and Android RN presets (see jest "projects"),
 * exercising native code paths (native Sheet/Modal, no web adapters).
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Slot } from 'expo-router';
import { Alert, Modal, Platform, Text } from 'react-native';
import { renderRouter } from 'expo-router/testing-library';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { MemoryKeyValue } from '../../../storage/keyValueStore';
import { AppProvider } from '../../../providers/AppProvider';
import { DayLogScreen } from '../DayLogScreen';
import { AppShell } from '../../shell/AppShell';

// One in-memory backend per test; a new store over it simulates an app restart.
let mockKv = new MemoryKeyValue();
jest.mock('../../../storage/openStore', () => ({
  openStore: async () => {
    const { KeyValueTrackingStore: Store } = jest.requireActual('../../../storage/keyValueStore');
    return new Store(mockKv);
  },
}));

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../../../platform/files', () => ({ shareJson: jest.fn(async () => {}), retainAsset: jest.fn(async () => null) }));
const { shareJson } = jest.requireMock('../../../platform/files') as { shareJson: jest.Mock };
const pickImages = ImagePicker.launchImageLibraryAsync as jest.Mock;

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
      '(main)/_layout': () => (
        <AppShell>
          <Slot />
        </AppShell>
      ),
      '(main)/index': DayLogScreen,
      import: () => <Text testID="import-route">import</Text>,
      configure: () => <Text testID="configure-route">configure</Text>,
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
  jest.clearAllMocks();
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


  first.unmount();
  await act(async () => {});
  await launch();
  expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 4 done');
  expect(screen.getByTestId('requirement-hard-conditioning')).toHaveTextContent(/Skipped/);
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

/** Choose a menu item. iOS runs it once the menu sheet has dismissed (Modal onDismiss), which the test renderer doesn't fire. */
async function chooseFromMenu(label: string) {
  fireEvent.press(screen.getByLabelText('Menu'));
  expect(await screen.findByTestId('app-menu')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(label));
  if (Platform.OS === 'ios') {
    const menu = screen.UNSAFE_getAllByType(Modal).find((m) => m.props.onDismiss);
    await act(async () => menu!.props.onDismiss());
  }
}

it("has no I'm hungry button or quick-log history, and app operations are in the menu", async () => {
  await launch();
  expect(screen.queryByLabelText("I'm hungry")).toBeNull();
  expect(screen.queryByTestId('quick-log-summary')).toBeNull();
  expect(screen.queryByLabelText('Import from screenshots')).toBeNull();
  expect(screen.queryByLabelText('Configure with AI')).toBeNull();
  expect(screen.queryByLabelText('Export all data')).toBeNull();

  fireEvent.press(screen.getByLabelText('Menu'));
  expect(await screen.findByTestId('app-menu')).toBeTruthy();
  for (const label of ['Import from screenshots', 'Configure with AI', 'Export all data']) expect(screen.getByLabelText(label)).toBeTruthy();
});

it('export asks first with the system alert; only Export JSON exports', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await launch();
  await chooseFromMenu('Export all data');
  expect(alert).toHaveBeenCalledTimes(1);
  const [title, message, buttons] = alert.mock.calls[0];
  expect(title).toBe('Export all fitness data?');
  expect(message).toMatch(/JSON file containing your complete fitness-tracker history/);
  expect(buttons!.map((b) => b.text)).toEqual(['Cancel', 'Export JSON']);

  await act(async () => buttons![0].onPress!());
  expect(shareJson).not.toHaveBeenCalled();

  await chooseFromMenu('Export all data');
  const [, , again] = alert.mock.calls[1];
  await act(async () => again![1].onPress!());
  await waitFor(() => expect(shareJson).toHaveBeenCalledTimes(1));
  expect(shareJson.mock.calls[0][0]).toBe('fitness-export-2026-11-05.json');
  expect(JSON.parse(shareJson.mock.calls[0][1])).toMatchObject({ format: 'pft-export' });
  alert.mockRestore();
});

it('import opens the photo picker straight away: cancel stays put, a selection opens the import flow', async () => {
  await launch();
  pickImages.mockResolvedValueOnce({ canceled: true, assets: null });
  await chooseFromMenu('Import from screenshots');
  expect(pickImages).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'], allowsMultipleSelection: true }));
  await act(async () => {});
  expect(screen.queryByTestId('import-route')).toBeNull();
  expect(screen.getByTestId('day-progress')).toBeTruthy();

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  pickImages.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///a.png', base64: png }, { uri: 'file:///b.png', base64: png }] });
  await chooseFromMenu('Import from screenshots');
  expect(await screen.findByTestId('import-route')).toBeTruthy();
  const { takeHandedOffScreenshots } = jest.requireActual('../../import/useImportSession');
  expect(takeHandedOffScreenshots()).toHaveLength(2);
});

it('configure opens the existing configuration flow', async () => {
  await launch();
  await chooseFromMenu('Configure with AI');
  expect(await screen.findByTestId('configure-route')).toBeTruthy();
});

it('the menu is in the app shell bar, not in the scrolling day (contract 02 layout layers)', async () => {
  await launch();
  expect(within(screen.getByTestId('app-bar')).getByLabelText('Menu')).toBeTruthy();
  expect(within(screen.getByTestId('day-scroll')).queryByLabelText('Menu')).toBeNull();
  expect(within(screen.getByTestId('day-scroll')).getByTestId('day-title')).toBeTruthy();
});

it('meal rows (#26): the body opens what to prepare without completing it; the circle completes it', async () => {
  await launch();
  fireEvent.press(screen.getByLabelText('Fixed lunch details'));
  const details = await screen.findByTestId('meal-details');
  expect(within(details).getByText('High-protein yoghurt')).toBeTruthy(); // the card shows it too: lunch is next
  expect(within(details).getByText('~¾ cup')).toBeTruthy();
  expect(screen.getByTestId('meal-details-preparation')).toHaveTextContent(/Add water as needed/);
  expect(screen.getByTestId('day-progress')).toHaveTextContent('0 of 5 done'); // viewing never completes
  fireEvent.press(screen.getAllByLabelText('Close')[0]);
  await waitFor(() => expect(screen.queryByTestId('meal-details')).toBeNull());

  fireEvent.press(screen.getByLabelText(/, Fixed lunch$/)); // the circle
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done'));
});

it('"Do this next" shows the lunch ingredients on the card (#26)', async () => {
  await launch(); // Thursday 09:00: lunch is next
  expect(screen.getByTestId('next-action-meal-ingredients')).toHaveTextContent(/Rolled oats/);
  expect(screen.getByTestId('next-action-meal-nutrition')).toHaveTextContent('≈ 1,780 kJ · 42 g protein');
});
