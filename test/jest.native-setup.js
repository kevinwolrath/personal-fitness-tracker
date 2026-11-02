// Native-only modules that have no implementation in the Jest host environment.
jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  const DateTimePicker = (props) => React.createElement(View, { testID: 'native-date-picker', ...props });
  return { __esModule: true, default: DateTimePicker, DateTimePickerAndroid: { open: jest.fn(), dismiss: jest.fn() } };
});

// expo-notifications needs a device. An in-memory stand-in with the calls the app uses; tests can inspect and
// steer it through `global.__notifications` (scheduled requests, permission, a simulated tap).
jest.mock('expo-notifications', () => {
  const state = { scheduled: new Map(), permission: { granted: false, status: 'undetermined', canAskAgain: true }, deny: false, listeners: new Set(), requests: 0 };
  global.__notifications = state;
  return {
    AndroidImportance: { DEFAULT: 3 },
    SchedulableTriggerInputTypes: { DATE: 'date' },
    setNotificationHandler: jest.fn(),
    setNotificationChannelAsync: jest.fn(async () => null),
    getPermissionsAsync: jest.fn(async () => ({ ...state.permission })),
    requestPermissionsAsync: jest.fn(async () => {
      state.requests++;
      state.permission = state.deny ? { granted: false, status: 'denied', canAskAgain: false } : { granted: true, status: 'granted', canAskAgain: true };
      return { ...state.permission };
    }),
    getAllScheduledNotificationsAsync: jest.fn(async () => [...state.scheduled.values()]),
    cancelScheduledNotificationAsync: jest.fn(async (id) => {
      state.scheduled.delete(id);
    }),
    scheduleNotificationAsync: jest.fn(async (req) => {
      state.scheduled.set(req.identifier, { identifier: req.identifier, content: req.content, trigger: req.trigger });
      return req.identifier;
    }),
    addNotificationResponseReceivedListener: jest.fn((cb) => {
      state.listeners.add(cb);
      return { remove: () => state.listeners.delete(cb) };
    }),
    getLastNotificationResponseAsync: jest.fn(async () => null),
  };
});

// Device storage (keystore) as a Map, so preferences persist across a simulated restart within a test.
jest.mock('expo-secure-store', () => {
  const store = new Map();
  global.__secureStore = store;
  return {
    getItemAsync: jest.fn(async (k) => (store.has(k) ? store.get(k) : null)),
    setItemAsync: jest.fn(async (k, v) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k) => {
      store.delete(k);
    }),
  };
});
