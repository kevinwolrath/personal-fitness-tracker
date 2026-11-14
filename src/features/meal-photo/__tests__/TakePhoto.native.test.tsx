/**
 * #183, one flow on the native presets: Take photo → camera → the share sheet with the photo AND the prompt → the AI's
 * block shared back to Body Anvil → the return page (Description, Energy kJ, Save) → back on the day, one meal.
 * The real Today screen, app shell (share receiver) and return route; the camera, storage, outgoing share and the
 * incoming Android share intent are stand-ins. What an AI app does in between is outside Body Anvil (not tested here).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { installSeedPlan } from '../../../plan/bootstrap';
import { QUICK_MEAL_PROMPT } from '../../../nutrition/prompt';
import { AppProvider } from '../../../providers/AppProvider';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';
import { DayLogScreen } from '../../daily-log/DayLogScreen';
import { AppShell } from '../../shell/AppShell';
import { RemindersProvider } from '../../reminders/RemindersProvider';
import { MealPhotoScreen } from '../MealPhotoScreen';
import { MealReturnScreen } from '../MealReturnScreen';

let mockKv = new MemoryKeyValue();
jest.mock('../../../storage/openStore', () => ({
  openStore: async () => {
    const { KeyValueTrackingStore: Store } = jest.requireActual('../../../storage/keyValueStore');
    return new Store(mockKv);
  },
}));

jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn(), launchImageLibraryAsync: jest.fn() }));
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

const mockFiles = { photos: new Map<string, string>(), pending: null as string | null, shareResult: 'shared' as 'shared' | 'unavailable' | 'dismissed' };
jest.mock('../../../platform/mealPhotos', () => ({
  keepPhoto: jest.fn(async (src: string, id: string) => {
    const uri = `file:///doc/meal-photos/${id}.jpg`;
    mockFiles.photos.set(uri, src);
    return uri;
  }),
  photoSource: (uri: string) => (mockFiles.photos.has(uri) ? uri : null),
  photoExists: async (uri: string) => mockFiles.photos.has(uri),
  deletePhoto: jest.fn(async (uri: string) => {
    mockFiles.photos.delete(uri);
  }),
  loadDraft: async () => null,
  saveDraft: async () => undefined,
  clearDraft: async () => undefined,
  loadPendingShare: async () => mockFiles.pending,
  savePendingShare: async (json: string) => {
    mockFiles.pending = json;
  },
  clearPendingShare: async () => {
    mockFiles.pending = null;
  },
  sharePhoto: jest.fn(async () => 'shared'),
  sharePhotoWithText: jest.fn(async () => mockFiles.shareResult),
  copyText: jest.fn(async () => true),
  readClipboard: async () => null,
}));
const files = jest.requireMock('../../../platform/mealPhotos') as { sharePhotoWithText: jest.Mock; deletePhoto: jest.Mock };

// The incoming Android share (expo-share-intent): set `mockShare.text` to simulate the AI app sharing to Body Anvil.
const mockShare = { text: null as string | null, resets: 0 };
jest.mock('expo-share-intent', () => {
  const { useState, useEffect } = jest.requireActual('react');
  return {
    useShareIntent: () => {
      const [text, setText] = useState(mockShare.text);
      useEffect(() => {
        const t = setInterval(() => setText(mockShare.text), 50);
        return () => clearInterval(t);
      }, []);
      return { isReady: true, hasShareIntent: !!text, shareIntent: { text, type: text ? 'text' : null, files: null, webUrl: null }, error: null, resetShareIntent: () => { mockShare.text = null; mockShare.resets++; setText(null); } };
    },
  };
});

const NOW = new Date(2026, 10, 5, 12, 5); // Thursday 5 Nov, 12:05: the fixed lunch is due
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const BLOCK = 'Beef curry with lentil dhal and rice\nEstimated energy: ~2,650 kJ\nProtein: ~45 g';

async function launch() {
  const utils = renderRouter(
    {
      _layout: () => (
        <SafeAreaProvider initialMetrics={metrics}>
          <AppProvider>
            <RemindersProvider>
              <Slot />
            </RemindersProvider>
          </AppProvider>
        </SafeAreaProvider>
      ),
      '(main)/_layout': () => (
        <AppShell>
          <Slot />
        </AppShell>
      ),
      '(main)/index': DayLogScreen,
      'meal-photo': () => <MealPhotoScreen />,
      'meal-return': () => <MealReturnScreen />,
      configure: () => <Text>configure</Text>,
    },
    { initialUrl: '/' },
  );
  jest.setSystemTime(NOW);
  return utils;
}
const store = () => new KeyValueTrackingStore(mockKv);
const shareBack = async (text: string) => {
  mockShare.text = text;
  await act(async () => { jest.advanceTimersByTime(100); });
};

beforeEach(async () => {
  mockKv = new MemoryKeyValue();
  await installSeedPlan(new KeyValueTrackingStore(mockKv));
  mockFiles.photos.clear();
  mockFiles.pending = null;
  mockFiles.shareResult = 'shared';
  mockShare.text = null;
  mockShare.resets = 0;
  jest.clearAllMocks();
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as never);
  picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/camera-1.jpg', width: 1200, height: 900 }] } as never);
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => jest.useRealTimers());

async function takePhoto() {
  await launch();
  await waitFor(() => expect(screen.getByTestId('next-action-title')).toHaveTextContent('Fixed lunch'));
  await act(async () => { fireEvent.press(screen.getByTestId('next-action-take-photo')); });
}

it('happy path: Take photo → camera → share sheet with photo + prompt → shared block → Save once → back on the day', async () => {
  await takePhoto();
  // The camera opened at once, and the share sheet straight after, with the photo and the prompt together.
  expect(picker.launchCameraAsync).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(files.sharePhotoWithText).toHaveBeenCalledTimes(1));
  const [uri, text] = files.sharePhotoWithText.mock.calls[0];
  expect(uri).toMatch(/^file:\/\/\/doc\/meal-photos\/.+\.jpg$/);
  expect(text).toBe(QUICK_MEAL_PROMPT);
  expect(JSON.parse(mockFiles.pending!)).toMatchObject({ date: '2026-11-05', activityId: 'lunch', replacedLabel: 'Fixed lunch', photo: { uri } });
  expect(screen.queryByTestId('meal-photo')).toBeNull(); // no wizard

  // The AI's block is shared back to Body Anvil.
  await shareBack(BLOCK);
  expect(await screen.findByTestId('meal-return')).toBeTruthy();
  expect(mockShare.resets).toBe(1); // the share is consumed once
  expect(screen.getByTestId('meal-return-context')).toHaveTextContent(/^Replaces Fixed lunch · /);
  expect(screen.getByTestId('meal-return-description').props.value).toBe('Beef curry with lentil dhal and rice');
  expect(screen.getByTestId('meal-return-energy').props.value).toBe('2650');
  expect(screen.getByTestId('meal-return-protein')).toHaveTextContent(/^Protein ≈ 45 g/);
  expect(screen.queryByTestId('meal-return-energy-error')).toBeNull();

  // One tap, even a double one: one meal, the lunch done, back on the day.
  await act(async () => {
    fireEvent.press(screen.getByTestId('meal-return-save'));
    fireEvent.press(screen.getByTestId('meal-return-save'));
  });
  await waitFor(() => expect(screen.queryByTestId('meal-return')).toBeNull());
  const logs = await store().mealLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ date: '2026-11-05', activityId: 'lunch', name: 'Beef curry with lentil dhal and rice', items: [{ energyKj: 2650, proteinG: 45 }], photos: [{ uri }] });
  expect((await store().getDay(logs[0].planId!, '2026-11-05')).activities.lunch?.status).toBe('done');
  expect(mockFiles.pending).toBeNull();
  expect(await screen.findByTestId('day-progress')).toBeTruthy();
});

it('a second photo for the same lunch replaces the first meal: still one, never counted twice', async () => {
  await takePhoto();
  await shareBack(BLOCK);
  await act(async () => { fireEvent.press(await screen.findByTestId('meal-return-save')); });
  await waitFor(() => expect(screen.queryByTestId('meal-return')).toBeNull());
  const first = (await store().mealLogs())[0];

  // Another photo for the same lunch (a new id was remembered for it): its block is shared back.
  mockFiles.pending = JSON.stringify({ id: 'other-id', date: '2026-11-05', planId: first.planId, activityId: 'lunch', replacedLabel: 'Fixed lunch', photo: null, startedAt: '2026-11-05T18:15:00+11:00' });
  await shareBack('Dinner: beef curry and dhal — ~2,400 kJ, 40 g protein');
  await act(async () => { fireEvent.press(await screen.findByTestId('meal-return-save')); });
  const logs = await store().mealLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ id: first.id, items: [{ energyKj: 2400, proteinG: 40 }] });
});

it('missing or ambiguous energy: inline error, Save needs a value; kcal converts; nothing invented', async () => {
  await takePhoto();
  await shareBack('Dinner: curry, 2,400–2,900 kJ, 45 g protein');
  expect(await screen.findByTestId('meal-return-energy-error')).toHaveTextContent(/range/);
  expect(screen.getByTestId('meal-return-energy').props.value).toBe('');
  await act(async () => { fireEvent.press(screen.getByTestId('meal-return-save')); });
  expect(await store().mealLogs()).toHaveLength(0);
  fireEvent.changeText(screen.getByTestId('meal-return-energy'), '2600');
  expect(screen.queryByTestId('meal-return-energy-error')).toBeNull();
  await act(async () => { fireEvent.press(screen.getByTestId('meal-return-save')); });
  await waitFor(async () => expect(await store().mealLogs()).toHaveLength(1));
  expect((await store().mealLogs())[0].items[0]).toMatchObject({ energyKj: 2600, proteinG: 45 });
});

it('junk text: both fields flagged inline; a typed description and kJ still save', async () => {
  await launch();
  await waitFor(() => expect(screen.getByTestId('next-action-title')).toBeTruthy());
  await shareBack('Thanks! Have a lovely evening.');
  expect(await screen.findByTestId('meal-return-description-error')).toBeTruthy();
  expect(screen.getByTestId('meal-return-energy-error')).toBeTruthy();
  // No photo was taken: the safe default is an extra meal today, nothing scheduled is replaced.
  expect(screen.getByTestId('meal-return-context')).toHaveTextContent(/^Extra meal · /);
  fireEvent.changeText(screen.getByTestId('meal-return-description'), 'Toast');
  fireEvent.changeText(screen.getByTestId('meal-return-energy'), '800');
  await act(async () => { fireEvent.press(screen.getByTestId('meal-return-save')); });
  await waitFor(async () => expect(await store().mealLogs()).toHaveLength(1));
  expect((await store().mealLogs())[0]).toMatchObject({ activityId: null, name: 'Toast', items: [{ energyKj: 800, proteinG: null }] });
});

it('kcal in the block is converted to kJ', async () => {
  await takePhoto();
  await shareBack('Grilled salmon, greens and rice — approx 633 kcal, 38 g protein');
  expect((await screen.findByTestId('meal-return-energy')).props.value).toBe('2648');
});

it('cancellations: the camera cancelled keeps nothing; Cancel on the return page saves nothing', async () => {
  picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: null } as never);
  await takePhoto();
  expect(files.sharePhotoWithText).not.toHaveBeenCalled();
  expect(mockFiles.pending).toBeNull();
  expect(mockFiles.photos.size).toBe(0);

  await shareBack(BLOCK);
  await act(async () => { fireEvent.press(await screen.findByLabelText('Cancel logging this meal')); });
  await waitFor(() => expect(screen.queryByTestId('meal-return')).toBeNull());
  expect(await store().mealLogs()).toHaveLength(0);
});

it('a camera that is denied, or a phone that can’t share, says so on the day (no wizard, no dialog)', async () => {
  picker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as never);
  await takePhoto();
  expect(await screen.findByText(/Camera access is off/)).toBeTruthy();
  expect(files.sharePhotoWithText).not.toHaveBeenCalled();

  mockFiles.shareResult = 'unavailable';
  await act(async () => { fireEvent.press(screen.getByTestId('next-action-take-photo')); });
  expect(await screen.findByText(/Sharing isn't available on this phone/)).toBeTruthy();
});

it('cold start: a share that opened the app lands on the return page with the remembered slot', async () => {
  mockFiles.pending = JSON.stringify({ id: 'cold-1', date: '2026-11-05', planId: 'weight-loss-v1', activityId: 'lunch', replacedLabel: 'Fixed lunch', photo: null, startedAt: '2026-11-05T18:00:00+11:00' });
  mockShare.text = BLOCK; // the intent is there before the app renders
  await launch();
  expect(await screen.findByTestId('meal-return')).toBeTruthy();
  expect(screen.getByTestId('meal-return-context')).toHaveTextContent(/^Replaces Fixed lunch · /);
  await act(async () => { fireEvent.press(screen.getByTestId('meal-return-save')); });
  await waitFor(async () => expect(await store().mealLogs()).toHaveLength(1));
  expect((await store().mealLogs())[0]).toMatchObject({ id: 'cold-1', activityId: 'lunch' });
});
