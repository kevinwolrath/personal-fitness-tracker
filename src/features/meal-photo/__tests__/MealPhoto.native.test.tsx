/**
 * "Log different meal" (#97) on the native presets: the real Today screen and the real wizard route, with the
 * camera, gallery, share sheet, clipboard and file storage replaced by in-memory stand-ins.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { Slot } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import { Alert, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { installSeedPlan } from '../../../plan/bootstrap';
import { AppProvider } from '../../../providers/AppProvider';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';
import { DayLogScreen } from '../../daily-log/DayLogScreen';
import { AppShell } from '../../shell/AppShell';
import { RemindersProvider } from '../../reminders/RemindersProvider';
import { MealPhotoScreen } from '../MealPhotoScreen';

let mockKv = new MemoryKeyValue();
jest.mock('../../../storage/openStore', () => ({
  openStore: async () => {
    const { KeyValueTrackingStore: Store } = jest.requireActual('../../../storage/keyValueStore');
    return new Store(mockKv);
  },
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;

// App-private photo storage, the draft file, the clipboard and the share sheet, in memory.
const mockFiles = { photos: new Map<string, string>(), draft: null as string | null, clipboard: '', shareResult: 'shared' as 'shared' | 'unavailable' | 'dismissed' };
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
  loadDraft: async () => mockFiles.draft,
  saveDraft: async (json: string) => {
    mockFiles.draft = json;
  },
  clearDraft: async () => {
    mockFiles.draft = null;
  },
  sharePhoto: jest.fn(async () => mockFiles.shareResult),
  copyText: jest.fn(async (t: string) => {
    mockFiles.clipboard = t;
    return true;
  }),
  readClipboard: async () => mockFiles.clipboard || null,
}));
const files = jest.requireMock('../../../platform/mealPhotos') as { sharePhoto: jest.Mock; copyText: jest.Mock; deletePhoto: jest.Mock };

const NOW = new Date(2026, 10, 5, 12, 5); // Thursday 5 Nov, 12:05: the fixed lunch is due
const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };

const reply = (over: Record<string, unknown> = {}) =>
  `Here's my estimate.\n\`\`\`json\n${JSON.stringify({
    schemaVersion: 1,
    mealName: 'Chicken burrito bowl',
    items: [
      { name: 'Rice', quantity: 180, unit: 'g', energyKj: 980, proteinG: 5, carbsG: 52, fatG: 1 },
      { name: 'Grilled chicken', quantity: 120, unit: 'g', energyKj: 830, proteinG: 30, carbsG: 0, fatG: 5 },
      { name: 'Guacamole', quantity: null, unit: null, energyKj: null, proteinG: null, carbsG: null, fatG: null },
    ],
    totals: { energyKj: 3100, proteinG: 38, carbsG: 82, fatG: 24 },
    confidence: 'medium',
    assumptions: ['Sauce not visible, not counted'],
    uncertainties: ['White or brown rice'],
    ...over,
  })}\n\`\`\``;

async function launch(initialUrl = '/') {
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
      import: () => <Text>import</Text>,
      configure: () => <Text>configure</Text>,
    },
    { initialUrl },
  );
  jest.setSystemTime(NOW);
  return utils;
}

const store = () => new KeyValueTrackingStore(mockKv);

beforeEach(async () => {
  mockKv = new MemoryKeyValue();
  await installSeedPlan(new KeyValueTrackingStore(mockKv));
  mockFiles.photos.clear();
  mockFiles.draft = null;
  mockFiles.clipboard = '';
  mockFiles.shareResult = 'shared';
  jest.clearAllMocks();
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' } as never);
  picker.launchCameraAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/camera-1.jpg', width: 1200, height: 900 }] } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///cache/gallery-1.jpg', width: 800, height: 600 }] } as never);
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => jest.useRealTimers());

async function openWizardFromCard() {
  await launch();
  await screen.findByTestId('next-action-title');
  expect(screen.getByTestId('next-action-title')).toHaveTextContent('Fixed lunch');
  fireEvent.press(screen.getByTestId('next-action-log-different'));
  await screen.findByTestId('meal-photo');
}

it('logs a different meal end to end: camera denied → gallery, share, bad paste, good paste, review, save', async () => {
  picker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as never);
  await openWizardFromCard();
  expect(screen.getByTestId('meal-context')).toHaveTextContent(/^Step 1 of 5 · Replaces Fixed lunch · /);

  // Camera permission denied: explained, with settings, and the gallery still works.
  fireEvent.press(screen.getByTestId('meal-camera'));
  expect(await screen.findByTestId('meal-camera-denied')).toHaveTextContent(/Camera access is off/);
  expect(screen.getByText('Open settings')).toBeTruthy();
  expect(picker.launchCameraAsync).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('meal-library'));
  await screen.findByTestId('meal-photo-0');
  expect(screen.getByTestId('meal-context')).toHaveTextContent(/^Step 2 of 5/);
  expect(mockFiles.photos.size).toBe(1); // copied into app storage

  fireEvent.press(within(screen.getByTestId('meal-bar')).getByText('Next'));
  await screen.findByTestId('meal-share');
  // Share with AI: the prompt is copied first, then the photo goes to the system share sheet.
  fireEvent.press(screen.getByTestId('meal-share'));
  await waitFor(() => expect(files.sharePhoto).toHaveBeenCalledTimes(1));
  expect(files.copyText.mock.calls[0][0]).toMatch(/kilojoules \(kJ, not kcal\)/);
  expect(files.copyText.mock.invocationCallOrder[0]).toBeLessThan(files.sharePhoto.mock.invocationCallOrder[0]);
  expect(await screen.findByTestId('meal-notice')).toHaveTextContent(/Prompt copied/);

  fireEvent.press(screen.getByTestId('meal-to-paste'));
  fireEvent.changeText(await screen.findByTestId('meal-reply'), 'Sure:\n```json\n{ "schemaVersion": 1, "mealName": "Chick');
  fireEvent.press(screen.getByTestId('meal-check'));
  expect(await screen.findByTestId('meal-reply-error')).toHaveTextContent(/cut off/);

  fireEvent.changeText(screen.getByTestId('meal-reply'), reply());
  fireEvent.press(screen.getByTestId('meal-check'));
  await screen.findByTestId('meal-review');
  expect(screen.getByTestId('meal-confidence')).toHaveTextContent('Medium confidence');
  expect(screen.getByTestId('meal-caveat')).toHaveTextContent(/not a measurement/);
  expect(screen.getByTestId('meal-totals')).toHaveTextContent(/≈ 1,810/); // from the items, not the AI's 3,100
  expect(screen.getByTestId('meal-discrepancies')).toHaveTextContent(/the AI’s total is 3,100 kJ; the foods add up to 1,810 kJ/);
  expect(screen.getByTestId('meal-assumptions')).toHaveTextContent(/Sauce not visible/);

  // Fill in the unknown guacamole, then save.
  fireEvent.changeText(screen.getByLabelText('Guacamole energy kJ'), '500');
  fireEvent.press(screen.getByTestId('meal-save'));

  await screen.findByTestId('replaced-lunch');
  expect(screen.getByTestId('replaced-lunch')).toHaveTextContent('Replaced: Chicken burrito bowl');
  expect(screen.getByTestId('day-progress')).toHaveTextContent('1 of 5 done');
  expect(screen.getByTestId('eaten')).toHaveTextContent(/Eaten ≈ 2,310 kJ · 35 g protein · 52 g carbs · 6 g fat/);
  expect(screen.getByTestId('eaten')).toHaveTextContent(/from 1 logged meal/);

  const logs = await store().mealLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ activityId: 'lunch', name: 'Chicken burrito bowl', source: 'photo-ai', edited: true, confidence: 'medium' });
  expect(logs[0].photos).toHaveLength(1);
  expect((await store().getDay(logs[0].planId!, '2026-11-05')).activities.lunch.status).toBe('done');
  expect(mockFiles.draft).toBeNull();
  expect(mockFiles.photos.size).toBe(1); // never deleted on save
});

it('resumes the draft after the app is killed while the user is in the AI app', async () => {
  await openWizardFromCard();
  fireEvent.press(screen.getByTestId('meal-camera'));
  await screen.findByTestId('meal-photo-0');
  fireEvent.press(within(screen.getByTestId('meal-bar')).getByText('Next'));
  fireEvent.press(await screen.findByTestId('meal-to-paste'));
  fireEvent.changeText(await screen.findByTestId('meal-reply'), 'half a reply');

  // The OS kills the app; the user opens it again and taps the same button.
  screen.unmount();
  await act(async () => {});
  await openWizardFromCard();
  expect(await screen.findByTestId('meal-reply')).toHaveProp('value', 'half a reply');
  expect(screen.getByTestId('meal-context')).toHaveTextContent(/^Step 4 of 5/);
  fireEvent.press(screen.getByText('Back'));
  fireEvent.press(await screen.findByText('Back'));
  expect(await screen.findByTestId('meal-photo-0')).toBeTruthy(); // the photo is still there
});

it('cancel deletes only the photos taken in the draft, and nothing is saved', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  await openWizardFromCard();
  fireEvent.press(screen.getByTestId('meal-camera'));
  await screen.findByTestId('meal-photo-0');
  fireEvent.press(screen.getByTestId('modal-dismiss'));
  expect(alert).toHaveBeenCalledWith('Discard this meal?', expect.any(String), expect.any(Array), expect.anything());
  await screen.findByTestId('day-progress');
  expect(mockFiles.photos.size).toBe(0);
  expect(mockFiles.draft).toBeNull();
  expect(await store().mealLogs()).toEqual([]);
  alert.mockRestore();
});

it('a share that isn’t available falls back to the copied prompt; enter-it-yourself works with no AI', async () => {
  mockFiles.shareResult = 'unavailable';
  await openWizardFromCard();
  fireEvent.press(screen.getByTestId('meal-library'));
  await screen.findByTestId('meal-photo-0');
  fireEvent.press(within(screen.getByTestId('meal-bar')).getByText('Next'));
  fireEvent.press(await screen.findByTestId('meal-share'));
  expect(await screen.findByTestId('meal-notice')).toHaveTextContent(/The prompt is copied: open your AI app, attach the photo/);
  expect(mockFiles.clipboard).toMatch(/schemaVersion/);

  fireEvent.press(screen.getByTestId('meal-to-paste'));
  fireEvent.press(await screen.findByTestId('meal-manual'));
  await screen.findByTestId('meal-review');
  fireEvent.press(screen.getByTestId('meal-save'));
  expect(await screen.findByTestId('meal-save-errors')).toHaveTextContent(/Give the meal a name/);
  fireEvent.changeText(screen.getByTestId('meal-name'), 'Toast');
  fireEvent.changeText(screen.getByLabelText('Food 1 name'), 'Toast');
  fireEvent.changeText(screen.getByLabelText('Toast energy kJ'), '400');
  fireEvent.press(screen.getByTestId('meal-save'));
  await screen.findByTestId('replaced-lunch');
  const logs = await store().mealLogs();
  expect(logs).toHaveLength(1);
  expect(logs[0]).toMatchObject({ source: 'manual', name: 'Toast', schemaVersion: null });
});

it('saving twice (a double tap) stores one meal', async () => {
  await openWizardFromCard();
  fireEvent.press(screen.getByTestId('meal-library'));
  await screen.findByTestId('meal-photo-0');
  fireEvent.press(within(screen.getByTestId('meal-bar')).getByText('Next'));
  fireEvent.press(await screen.findByTestId('meal-to-paste'));
  fireEvent.changeText(await screen.findByTestId('meal-reply'), reply());
  fireEvent.press(screen.getByTestId('meal-check'));
  const save = await screen.findByTestId('meal-save');
  fireEvent.press(save);
  fireEvent.press(save);
  await screen.findByTestId('replaced-lunch');
  expect(await store().mealLogs()).toHaveLength(1);
});

it('shows a missing photo in the meal sheet; removing the meal undoes the replacement and deletes its photos', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
  await openWizardFromCard();
  fireEvent.press(screen.getByTestId('meal-library'));
  await screen.findByTestId('meal-photo-0');
  fireEvent.press(within(screen.getByTestId('meal-bar')).getByText('Next'));
  fireEvent.press(await screen.findByTestId('meal-to-paste'));
  fireEvent.changeText(await screen.findByTestId('meal-reply'), reply());
  fireEvent.press(screen.getByTestId('meal-check'));
  fireEvent.press(await screen.findByTestId('meal-save'));
  await screen.findByTestId('replaced-lunch');

  // The row's sheet shows what was eaten; the photo file has gone missing (e.g. cleared by the user).
  mockFiles.photos.clear();
  fireEvent.press(screen.getByLabelText(/Fixed lunch, replaced by Chicken burrito bowl/));
  expect(await screen.findByTestId('replaced-meal')).toHaveTextContent(/Photo estimate/);
  expect(screen.getByText('Missing')).toBeTruthy();
  expect(screen.queryByText('Mark not done')).toBeNull();

  fireEvent.press(screen.getByTestId('replaced-meal-remove'));
  await waitFor(() => expect(screen.queryByTestId('replaced-lunch')).toBeNull());
  expect(screen.getByTestId('day-progress')).toHaveTextContent('0 of 5 done');
  expect(await store().mealLogs()).toEqual([]);
  expect(files.deletePhoto).toHaveBeenCalled();
  alert.mockRestore();
});
