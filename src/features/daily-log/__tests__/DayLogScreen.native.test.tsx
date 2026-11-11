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
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';
import { installSeedPlan } from '../../../plan/bootstrap';
import { AppProvider } from '../../../providers/AppProvider';
import { DayLogScreen } from '../DayLogScreen';
import { AppShell } from '../../shell/AppShell';
import { HC_DISTANCE } from '../../../observations/healthConnect';

// One in-memory backend per test; a new store over it simulates an app restart.
let mockKv = new MemoryKeyValue();
jest.mock('../../../storage/openStore', () => ({
  openStore: async () => {
    const { KeyValueTrackingStore: Store } = jest.requireActual('../../../storage/keyValueStore');
    return new Store(mockKv);
  },
}));

jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('../../../platform/files', () => ({ shareJson: jest.fn(async () => {}) }));
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
      configure: () => <Text testID="configure-route">configure</Text>,
    },
    { initialUrl: '/' },
  );
  // renderRouter re-installs fake timers (resetting the clock); Today mounts after the store loads, so re-pin now.
  jest.setSystemTime(NOW);
  await screen.findByTestId('day-progress');
  return utils;
}

beforeEach(async () => {
  mockKv = new MemoryKeyValue();
  // An install that already runs the bundled seed plan (new installs go through setup, #49).
  await installSeedPlan(new KeyValueTrackingStore(mockKv));
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

/** Move the clock to a local time today and let the minute timer fire (#51). */
async function at(h: number, m: number) {
  jest.setSystemTime(new Date(2026, 10, 5, h, m - 1)); // the next minute tick lands just after h:m
  await act(async () => jest.advanceTimersByTime(61_000));
}

it('nothing reasonable to do now: no card and no placeholder; the checklist is unchanged (#41)', async () => {
  await launch();
  // Thursday 09:00, office day: lunch (12:00) isn't due until 11:45, more than an hour away.
  expect(screen.queryByTestId('next-action')).toBeNull();
  expect(screen.queryByTestId('up-next')).toBeNull();
  expect(screen.queryByText(/Nothing left|Nothing planned/)).toBeNull();
  expect(screen.getByTestId('activity-lunch')).toBeTruthy();
  expect(screen.getByTestId('day-progress')).toHaveTextContent('0 of 5 done');
  expect(screen.getByTestId('measurement-weight')).toBeTruthy();
});

it('recalculates when the app resumes, not only on the minute tick (#41)', async () => {
  await launch();
  expect(screen.queryByTestId('up-next')).toBeNull();
  const { AppState } = jest.requireActual<typeof import('react-native')>('react-native');
  const listeners = (AppState.addEventListener as jest.Mock).mock.calls.filter((c) => c[0] === 'change').map((c) => c[1] as (s: string) => void);
  jest.setSystemTime(new Date(2026, 10, 5, 11, 50, 30)); // back after a while, before the minute timer fires
  await act(async () => listeners.forEach((l) => l('active'))); // what the OS does on resume
  expect(screen.getByTestId('next-action-title')).toHaveTextContent('Fixed lunch');
});

it('recalculates when the day type changes: Home brings the school run (#41)', async () => {
  await launch();
  await at(8, 40);
  expect(screen.queryByTestId('next-action')).toBeNull(); // office day: nothing due
  fireEvent.press(screen.getByLabelText(/Day type: Office day/));
  fireEvent.press(await screen.findByLabelText('Home day'));
  await waitFor(() => expect(screen.getByTestId('next-action-title')).toHaveTextContent('School run'));
});

it('before anything is due, "Up next" is a compact preview within the hour: no meal, no Done (#51, #41)', async () => {
  await launch();
  await at(10, 45); // lunch (12:00) becomes due at 11:45: exactly an hour away
  expect(screen.getByTestId('up-next-title')).toHaveTextContent('Fixed lunch');
  expect(screen.getByTestId('up-next-when')).toHaveTextContent(/Up next · 12:00/i);
  expect(screen.getByTestId('up-next-countdown')).toHaveTextContent(/^In 1 hr 15 min/);
  expect(screen.queryByTestId('next-action')).toBeNull();
  expect(screen.queryByTestId('next-action-meal-ingredients')).toBeNull();
  expect(screen.queryByLabelText('Done: Fixed lunch')).toBeNull();
  // Weight stays on screen with the card.
  expect(screen.getByTestId('measurement-weight')).toBeTruthy();
});

it('Details on "Up next" allows completing early, deliberately (#51)', async () => {
  await launch();
  await at(11, 0);
  fireEvent.press(screen.getByLabelText('Up next details: Fixed lunch'));
  expect(await screen.findByTestId('meal-details')).toBeTruthy();
  expect(screen.getByTestId('day-progress')).toHaveTextContent('0 of 5 done'); // opening never completes
});

it('becomes the full card when due, updates with the clock, and moves on after Done (#51)', async () => {
  await launch();
  await at(11, 44);
  expect(screen.getByTestId('up-next-countdown')).toHaveTextContent(/^In 16 min/);
  await at(11, 45); // meals are due 15 min before
  expect(screen.queryByTestId('up-next')).toBeNull();
  expect(screen.getByTestId('next-action-title')).toHaveTextContent('Fixed lunch');
  expect(screen.getByTestId('next-action-when')).toHaveTextContent(/In 15 min · 12:00/i);
  await at(12, 0);
  expect(screen.getByTestId('next-action-when')).toHaveTextContent(/Now · 12:00/i);
  fireEvent.press(screen.getByLabelText('Done: Fixed lunch'));
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done'));
  // The lunch walk (12:30, exercise: due from 12:00) is due now.
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
  for (const label of ['Health Connect', 'Configure with AI', 'Export all data']) expect(screen.getByLabelText(label)).toBeTruthy();
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

it('#138: screenshot import is gone: no menu item, no picker, no import route', async () => {
  await launch();
  fireEvent.press(screen.getByLabelText('Menu'));
  expect(await screen.findByTestId('app-menu')).toBeTruthy();
  expect(screen.queryByLabelText('Import from screenshots')).toBeNull();
  expect(screen.queryByText(/screenshot/i)).toBeNull();
  expect(pickImages).not.toHaveBeenCalled();
  expect(screen.queryByTestId('import-route')).toBeNull();
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
  expect(within(details).getByText('High-protein yoghurt')).toBeTruthy();
  expect(within(details).getByText('~¾ cup')).toBeTruthy();
  expect(screen.getByTestId('meal-details-preparation')).toHaveTextContent(/Add water as needed/);
  expect(screen.getByTestId('day-progress')).toHaveTextContent('0 of 5 done'); // viewing never completes
  fireEvent.press(screen.getAllByLabelText('Close')[0]);
  await waitFor(() => expect(screen.queryByTestId('meal-details')).toBeNull());

  fireEvent.press(screen.getByLabelText(/, Fixed lunch$/)); // the circle
  await waitFor(() => expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done'));
});

it('"Do this next" shows the lunch ingredients on the card once lunch is due (#26, #51)', async () => {
  await launch();
  await at(11, 50);
  expect(screen.getByTestId('next-action-meal-ingredients')).toHaveTextContent(/Rolled oats/);
  expect(screen.getByTestId('next-action-meal-nutrition')).toHaveTextContent('≈ 1,780 kJ · 42 g protein');
});

describe('reminders (#30)', () => {
  const n = () => (global as any).__notifications;
  const ours = () => [...n().scheduled.keys()].filter((id: string) => id.startsWith('pft-reminder|'));
  const todays = (activity: string) => ours().filter((id: string) => id.includes('|2026-11-05|') && id.includes(`|${activity}|`));
  beforeEach(() => {
    n().scheduled.clear();
    n().permission = { granted: false, status: 'undetermined', canAskAgain: true };
    n().deny = false;
    n().requests = 0;
    (global as any).__secureStore.clear();
  });
  // Let the (promise-only) reminder sync run to completion; fake timers freeze setImmediate.
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve();
    });

  it('off by default: nothing is scheduled and permission is never asked on launch', async () => {
    await launch();
    await settle();
    expect(ours()).toHaveLength(0);
    expect(n().requests).toBe(0);
  });

  it('Turn on asks once, schedules the plan’s week, and switching off/on cancels and rebuilds; completing lunch cancels it', async () => {
    const first = await launch();
    await chooseFromMenu('Reminders');
    fireEvent.press(await screen.findByText('Turn on reminders'));
    await settle();
    expect(n().requests).toBe(1);
    // Thursday 09:00: lunch, snack and dinner today + 6 more days.
    await waitFor(() => expect(ours()).toHaveLength(21));
    expect(todays('lunch')).toHaveLength(1);

    // Completing lunch cancels today's lunch reminder only.
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    fireEvent.press(screen.getByLabelText(/, Fixed lunch$/));
    await settle();
    await waitFor(() => expect(todays('lunch')).toHaveLength(0));
    expect(ours()).toHaveLength(20);

    // Restart: no duplicates, nothing lost, no new permission prompt.
    first.unmount();
    await act(async () => {});
    await launch();
    await settle();
    await waitFor(() => expect(ours()).toHaveLength(20));
    expect(n().requests).toBe(1);

    // Off cancels everything; on rebuilds from the current plan.
    await chooseFromMenu('Reminders');
    fireEvent(await screen.findByTestId('reminders-switch'), 'valueChange', false);
    await settle();
    await waitFor(() => expect(ours()).toHaveLength(0));
    fireEvent.press(await screen.findByText('Turn on reminders'));
    await settle();
    await waitFor(() => expect(ours()).toHaveLength(20));
  });

  it('denied permission: the app carries on, shows it is blocked, and never asks again by itself', async () => {
    n().deny = true;
    const first = await launch();
    await chooseFromMenu('Reminders');
    fireEvent.press(await screen.findByText('Turn on reminders'));
    await settle();
    expect(await screen.findByTestId('reminders-blocked')).toBeTruthy();
    expect(ours()).toHaveLength(0);
    first.unmount();
    await act(async () => {});
    await launch();
    await settle();
    expect(n().requests).toBe(1);
    expect(screen.getByTestId('day-progress')).toBeTruthy();
  });

  it('tapping a reminder opens that day with the activity’s details', async () => {
    await launch();
    await settle();
    const tap = [...n().listeners][0] as (r: unknown) => void;
    await act(async () => tap({ notification: { request: { content: { data: { date: '2026-11-05', activityId: 'snack' } } } } }));
    expect(await screen.findByTestId('modal-title')).toHaveTextContent('Fixed snack'); // its details sheet is open
  });
});

describe('Health Connect (#36)', () => {
  // The library mock (test/jest.native-setup.js) is created on first require.
  const hc = () => (jest.requireMock('react-native-health-connect'), (global as any).__healthConnect);
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 80; i++) await Promise.resolve();
    });
  const SAMSUNG = 'com.sec.android.app.shealth';
  // Health Connect returns instants; these are local times on 4–5 Nov in whatever zone the test runs in.
  const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
  const ALL = ['Steps', 'ActiveCaloriesBurned', 'ExerciseSession', 'Weight', 'BodyFat', 'SleepSession'];
  beforeEach(() => {
    Object.assign(hc(), {
      status: 3,
      grantOnRequest: ALL,
      granted: [],
      stepsByDay: { '2026-11-05': 6214, '2026-11-04': 9001 },
      kcalByDay: { '2026-11-05': 320 },
      records: {
        ExerciseSession: [{ startTime: at(5, 7, 30), endTime: at(5, 8, 2), exerciseType: 79, metadata: { id: 'ex1', dataOrigin: SAMSUNG } }],
        Weight: [{ time: at(5, 6, 58), weight: { inKilograms: 82.4 }, metadata: { id: 'w1', dataOrigin: 'com.withings.wiscale2' } }],
        BodyFat: [{ time: at(5, 6, 58), percentage: 32.8, metadata: { id: 'bf1', dataOrigin: 'com.withings.wiscale2' } }],
        SleepSession: [{ startTime: at(4, 23), endTime: at(5, 6, 45), metadata: { id: 's1', dataOrigin: SAMSUNG } }],
      },
      failRecordTypes: [],
      requests: [],
      writes: [],
      openedSettings: 0,
    });
    (global as any).__secureStore.clear();
  });

  if (Platform.OS !== 'android') {
    it('is not available on iOS, and the app works as usual', async () => {
      await launch();
      await settle();
      await chooseFromMenu('Health Connect');
      expect(await screen.findByTestId('hc-unsupported')).toBeTruthy();
      expect(hc().requests).toHaveLength(0);
    });
    return;
  }

  it('never asks or reads on launch before the user connects', async () => {
    await launch();
    await settle();
    expect(hc().requests).toHaveLength(0);
    expect(screen.queryByTestId('recorded-steps')).toBeNull();
  });

  it('Connect asks for the six read permissions (Distance is off until declared in Play), imports into the Daily Log with sources, and writes nothing', async () => {
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    expect(hc().requests).toHaveLength(1);
    expect(hc().requests[0]).toEqual(ALL.map((recordType) => ({ accessType: 'read', recordType })));
    await waitFor(() => expect(screen.getByTestId('hc-today-steps')).toHaveTextContent(/✓ 6,214 today · Samsung Health/));
    expect(screen.getByTestId('hc-today-weight')).toHaveTextContent(/✓ 82\.4 kg today · Withings/);
    expect(screen.getByTestId('hc-today-sleep')).toHaveTextContent(/7 hr 45 min/);
    expect(screen.getByTestId('hc-today-exercise')).toHaveTextContent(/Walk 32 min/);

    fireEvent.press(screen.getByTestId('modal-dismiss'));
    // The Daily Log shows them in its existing places: Recorded rows and the Weight tile.
    await waitFor(() => expect(screen.getByTestId('recorded-steps')).toHaveTextContent(/6,214/));
    expect(screen.getByTestId('recorded-steps')).toHaveTextContent(/Samsung Health/);
    expect(screen.getByTestId('measurement-weight')).toHaveTextContent(/82\.4/);
    expect(hc().writes).toEqual([]);
  });

  it('#116: an unticked type isn’t asked for; Allow later asks Android for just that one, and the result is read back', async () => {
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByLabelText('Import body fat'));
    fireEvent.press(screen.getByText('Connect Health Connect'));
    await settle();
    expect(hc().requests[0].map((p: { recordType: string }) => p.recordType)).toEqual(ALL.filter((t) => t !== 'BodyFat'));
    await waitFor(() => expect(screen.getByTestId('hc-summary')).toHaveTextContent(/^5 of 5 working$/));

    // Ticked later; Android shows nothing this time (refused twice before): the app reads back what it has.
    fireEvent.press(screen.getByLabelText('Import body fat'));
    hc().grantOnRequest = [];
    fireEvent.press(await screen.findByText('Allow body fat'));
    await settle();
    expect(hc().requests[1]).toEqual([{ accessType: 'read', recordType: 'BodyFat' }]);
    await waitFor(() => expect(screen.getByTestId('hc-check-result')).toHaveTextContent(/Body fat still isn't allowed\./));

    // Allowed in Health Connect's own screen; back in the app it's confirmed.
    hc().granted = [...hc().granted, 'BodyFat'];
    fireEvent.press(screen.getByTestId('hc-check-again'));
    await settle();
    await waitFor(() => expect(screen.getByTestId('hc-check-result')).toHaveTextContent(/Body fat is working now\. 32\.8 % from Withings\./));
    expect(hc().writes).toEqual([]);
  });

  it('while Distance is off (not yet declared in Play), it is never read, even if granted', async () => {
    hc().grantOnRequest = [...ALL, 'Distance'];
    hc().records.Distance = [{ startTime: at(5, 7, 30), endTime: at(5, 8, 2), distance: { inMeters: 2500 }, metadata: { id: 'd1', dataOrigin: SAMSUNG } }];
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    expect(screen.queryByText(/Distance access/)).toBeNull();
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    await waitFor(() => expect(screen.getByTestId('recorded-walking-summary')).toHaveTextContent(/32 min/));
    expect(screen.getByTestId('recorded-walking-summary')).not.toHaveTextContent(/km/);
  });

  // Runs again once HC_DISTANCE (src/observations/healthConnect.ts) is turned back on.
  (HC_DISTANCE ? it : it.skip)('reads optional Distance only with permission and keeps duration if Distance fails', async () => {
    hc().grantOnRequest = [...ALL, 'Distance'];
    hc().records.Distance = [{ startTime: at(5, 7, 30), endTime: at(5, 8, 2), distance: { inMeters: 2500 }, metadata: { id: 'd1', dataOrigin: SAMSUNG } }];
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    await waitFor(() => expect(screen.getByTestId('recorded-walking-summary')).toHaveTextContent(/2\.5 km/));
    await chooseFromMenu('Health Connect');
    hc().failRecordTypes = ['Distance'];
    fireEvent.press(screen.getByText('Check again'));
    await settle();
    expect(screen.getByTestId('hc-today-exercise')).toHaveTextContent(/32 min/);
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    await waitFor(() => expect(screen.getByTestId('recorded-walking-summary')).not.toHaveTextContent(/km/));
    expect(hc().writes).toEqual([]);
  });

  it('a value entered by hand wins over the imported one, and a re-sync never overwrites it', async () => {
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    await waitFor(() => expect(screen.getByTestId('measurement-weight')).toHaveTextContent(/82\.4/));

    fireEvent.press(screen.getByTestId('measurement-weight'));
    fireEvent.changeText(await screen.findByLabelText(/Weight in kg/), '81.9');
    fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByTestId('measurement-weight')).toHaveTextContent(/81\.9/));

    // Sync again (foreground return): the manual value still shows; both records are kept.
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Check again'));
    await settle();
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    await waitFor(() => expect(screen.getByTestId('measurement-weight')).toHaveTextContent(/81\.9/));
  });

  it('a type that fails to read doesn’t stop the others, and the app keeps working', async () => {
    hc().failRecordTypes = ['SleepSession'];
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    await waitFor(() => expect(screen.getByTestId('hc-sync-status')).toHaveTextContent(/Last sync didn't finish/));
    expect(screen.getByTestId('hc-today-steps')).toHaveTextContent(/6,214/);
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    expect(screen.getByTestId('day-progress')).toBeTruthy();
  });

  it('revoking sleep only: steps refresh, the last sleep values are kept, no new request (#43)', async () => {
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    await waitFor(() => expect(screen.getByTestId('hc-today-sleep')).toHaveTextContent(/7 hr 45 min/));

    // Sleep revoked in Health Connect; steps still allowed and changed; the sleep data there changed too.
    hc().granted = ALL.filter((t) => t !== 'SleepSession');
    hc().stepsByDay['2026-11-05'] = 8100;
    hc().records.SleepSession = [];
    const readsBefore = (jest.requireMock('react-native-health-connect') as any).readRecords.mock.calls.length;
    fireEvent.press(screen.getByText('Check again'));
    await settle();

    await waitFor(() => expect(screen.getByTestId('hc-today-steps')).toHaveTextContent(/8,100/));
    expect(screen.getByTestId('hc-today-sleep')).toHaveTextContent(/Not allowed/);
    const reads = (jest.requireMock('react-native-health-connect') as any).readRecords.mock.calls.slice(readsBefore).map((c: any[]) => c[0]);
    expect(reads).not.toContain('SleepSession');
    expect(hc().requests).toHaveLength(1);
    fireEvent.press(screen.getByTestId('modal-dismiss'));
    await waitFor(() => expect(screen.getByTestId('recorded-sleep_duration')).toHaveTextContent(/7 hr 45 min/));
    expect(hc().writes).toEqual([]);
  });

  it('a failed permission check is reported, not shown as "not connected"; imported values stay (#44)', async () => {
    await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    await waitFor(() => expect(screen.getByTestId('hc-today-steps')).toHaveTextContent(/6,214/));
    const lib = jest.requireMock('react-native-health-connect') as any;
    lib.getGrantedPermissions.mockRejectedValueOnce(new Error('binder died'));
    fireEvent.press(screen.getByText('Check again'));
    await settle();
    expect(await screen.findByTestId('hc-check-failed')).toHaveTextContent(/Nothing was changed/);
    expect(screen.queryByText('Connect Health Connect')).toBeNull(); // still connected
    expect(screen.getByTestId('hc-today-steps')).toHaveTextContent(/6,214/);
    expect(hc().requests).toHaveLength(1); // no re-ask
  });

  it('refusing access: nothing is read, the sheet says so, and it never asks again by itself', async () => {
    hc().grantOnRequest = [];
    const first = await launch();
    await chooseFromMenu('Health Connect');
    fireEvent.press(await screen.findByText('Connect Health Connect'));
    await settle();
    expect(await screen.findByTestId('hc-refused')).toBeTruthy();
    first.unmount();
    await act(async () => {});
    await launch();
    await settle();
    expect(hc().requests).toHaveLength(1);
    expect(screen.queryByTestId('recorded-steps')).toBeNull();
  });

  it('Health Connect missing: the sheet offers to install it; nothing else changes', async () => {
    hc().status = 1;
    await launch();
    await settle();
    await chooseFromMenu('Health Connect');
    expect(await screen.findByTestId('hc-install')).toHaveTextContent(/isn’t installed/);
    expect(screen.getByText('Get Health Connect')).toBeTruthy();
  });
});
