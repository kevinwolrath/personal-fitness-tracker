import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { journeySnapshot } from '../../../fixtures/gamification/journey';
import { secrets } from '../../platform/secrets';
import { GamificationCard } from '../Gamification';
import { GamificationProvider, LOAD_ERROR, LOAD_TIMEOUT_MS } from '../GamificationProvider';
import type { StoreSnapshot } from '../../storage/types';

/**
 * #176: the Quests card never shows an endless "Loading quests…". It loads (also on a fresh, empty database); when the
 * store rejects, stalls, or building the game throws, it says so and offers Retry, which recovers.
 */
jest.setTimeout(30000);
let mockSnapshot: () => Promise<StoreSnapshot> = async () => journeySnapshot(1);
const mockStore = { snapshot: jest.fn(() => mockSnapshot()), getDay: jest.fn(), addQuickLog: jest.fn(), removeQuickLog: jest.fn() };
jest.mock('../../providers/AppProvider', () => {
  const { journeyPlan: mockPlan } = jest.requireActual('../../../fixtures/gamification/journey');
  return { useApp: () => ({ store: mockStore, plan: mockPlan, dataVersion: 0 }) };
});
jest.mock('../../features/daily-log/useDay', () => {
  const { START: mockToday } = jest.requireActual('../../../fixtures/gamification/journey');
  return { useClock: () => ({ today: mockToday }) };
});
jest.mock('../../platform/secrets', () => ({ secrets: { get: jest.fn(), set: jest.fn() } }));

const enabled = JSON.stringify({ version: 1, enabled: true, seen: [] });
let info: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  (secrets.get as jest.Mock).mockResolvedValue(enabled);
  (secrets.set as jest.Mock).mockResolvedValue(undefined);
  mockSnapshot = async () => journeySnapshot(1);
  info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});
afterEach(() => info.mockRestore());
const show = () => render(<GamificationProvider><GamificationCard /></GamificationProvider>);

it('loads quests (no endless spinner) and logs each step without health data', async () => {
  show();
  await waitFor(() => expect(screen.getByTestId('gamification-card')).toBeTruthy());
  expect(screen.queryByTestId('gamification-loading')).toBeNull();
  const logged = info.mock.calls.map((c) => c.join(' '));
  expect(logged.some((l) => l.startsWith('[quests] load start'))).toBe(true);
  expect(logged.some((l) => l.startsWith('[quests] snapshot ok') && /"ms":\d+/.test(l))).toBe(true);
  expect(logged.some((l) => l.startsWith('[quests] quests ok'))).toBe(true);
  expect(logged.join(' ')).not.toMatch(/"value"|kg|weight/);
});

it('a fresh, empty database loads at level 1', async () => {
  mockSnapshot = async () => ({ ...journeySnapshot(0), activityLogs: [], observations: [], quickLogs: [], configChanges: [], daySnapshots: [], mealLogs: [], exerciseLogs: [] });
  show();
  await waitFor(() => expect(screen.getByTestId('game-level')).toHaveTextContent('Level 1 · 0 XP'));
});

it('a rejected store shows a recoverable error; Retry loads', async () => {
  mockSnapshot = async () => { throw new Error('database locked'); };
  show();
  await waitFor(() => expect(screen.getByTestId('gamification-error')).toHaveTextContent(LOAD_ERROR, { exact: false }));
  mockSnapshot = async () => journeySnapshot(1);
  fireEvent.press(screen.getByTestId('gamification-retry'));
  await waitFor(() => expect(screen.getByTestId('gamification-card')).toBeTruthy());
  expect(screen.queryByTestId('gamification-error')).toBeNull();
});

it('a failure while building the game (the #176 bug) is an error with Retry, not "Loading quests…" forever', async () => {
  mockSnapshot = async () => ({ ...journeySnapshot(1), activityLogs: undefined as never });
  show();
  await waitFor(() => expect(screen.getByTestId('gamification-error')).toHaveTextContent(LOAD_ERROR, { exact: false }));
  expect(screen.queryByTestId('gamification-loading')).toBeNull();
  expect(info.mock.calls.map((c) => c.join(' ')).some((l) => l.startsWith('[quests] load failed') && l.includes('TypeError'))).toBe(true);
});

it('a store that never answers offers Retry after the timeout; a later answer still loads', async () => {
  jest.useFakeTimers();
  try {
    let answer!: (s: StoreSnapshot) => void;
    mockSnapshot = () => new Promise((resolve) => { answer = resolve; });
    show();
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('gamification-loading')).toHaveTextContent('Loading quests…');
    await act(async () => { jest.advanceTimersByTime(LOAD_TIMEOUT_MS + 1); });
    expect(screen.getByTestId('gamification-error')).toHaveTextContent(LOAD_ERROR, { exact: false });
    await act(async () => { answer(journeySnapshot(1)); });
    expect(screen.getByTestId('gamification-card')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});
