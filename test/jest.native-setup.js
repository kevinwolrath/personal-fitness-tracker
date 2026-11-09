// Native-only modules that have no implementation in the Jest host environment.
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => true), hideAsync: jest.fn(async () => undefined) }));
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

// Android Health Connect (#36) as an in-memory stand-in with the library's API shape. Tests drive it through
// `global.__healthConnect`: status, what a permission request grants, aggregates per day and raw records.
// It records every call, so tests can prove nothing is ever written (`writes` must stay empty).
jest.mock('react-native-health-connect', () => {
  const state = {
    status: 3,
    grantOnRequest: [],
    granted: [],
    stepsByDay: {},
    kcalByDay: {},
    records: { ExerciseSession: [], Weight: [], BodyFat: [], SleepSession: [] },
    failRecordTypes: [],
    requests: [],
    writes: [],
    openedSettings: 0,
  };
  global.__healthConnect = state;
  const day = (iso) => {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const fail = (t) => {
    if (state.failRecordTypes.includes(t)) throw new Error(`read ${t} failed`);
  };
  return {
    SdkAvailabilityStatus: { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 },
    getSdkStatus: jest.fn(async () => state.status),
    initialize: jest.fn(async () => true),
    getGrantedPermissions: jest.fn(async () => state.granted.map((recordType) => ({ accessType: 'read', recordType }))),
    requestPermission: jest.fn(async (perms) => {
      state.requests.push(perms);
      state.granted = [...new Set([...state.granted, ...perms.map((p) => p.recordType).filter((t) => state.grantOnRequest.includes(t))])];
      return state.granted.map((recordType) => ({ accessType: 'read', recordType }));
    }),
    aggregateRecord: jest.fn(async ({ recordType, timeRangeFilter }) => {
      fail(recordType);
      const d = day(timeRangeFilter.startTime);
      if (recordType === 'Steps') return { COUNT_TOTAL: state.stepsByDay[d] ?? 0, dataOrigins: state.stepsByDay[d] ? ['com.sec.android.app.shealth'] : [] };
      const kcal = state.kcalByDay[d] ?? 0;
      return { ACTIVE_CALORIES_TOTAL: { inKilocalories: kcal }, dataOrigins: kcal ? ['com.sec.android.app.shealth'] : [] };
    }),
    readRecords: jest.fn(async (recordType, { timeRangeFilter }) => {
      fail(recordType);
      const from = new Date(timeRangeFilter.startTime).getTime();
      const to = new Date(timeRangeFilter.endTime).getTime();
      const at = (r) => new Date(r.time ?? r.startTime).getTime();
      return { records: (state.records[recordType] ?? []).filter((r) => at(r) >= from && at(r) < to) };
    }),
    insertRecords: jest.fn(async (r) => state.writes.push(['insert', r])),
    deleteRecordsByUuids: jest.fn(async (...a) => state.writes.push(['delete', a])),
    deleteRecordsByTimeRange: jest.fn(async (...a) => state.writes.push(['delete', a])),
    openHealthConnectSettings: jest.fn(() => {
      state.openedSettings += 1;
    }),
  };
});
