import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';
import { FakeHealthServer } from '../../../healthSync/__tests__/fakeServer';

/**
 * #168: Share everything is one tap on the Health data sync sheet: sync, a 24-hour link to all history, then the
 * system share sheet with the link. A failed sync shares nothing. Advanced sharing stays one quiet tap away.
 */
jest.mock('../../../healthSync/config', () => ({
  BUILD_API: { ok: true, url: 'https://health.example.test' },
  BUILD_ENROLLMENT_KEY: 'e'.repeat(64),
  DEV_BUILD: false,
}));
jest.mock('../../../platform/secrets', () => {
  const map = new Map<string, string>();
  return { secrets: { get: async (k: string) => map.get(k) ?? null, set: async (k: string, v: string) => void map.set(k, v), remove: async (k: string) => void map.delete(k) } };
});
jest.mock('../../../platform/random', () => ({ random: { uuid: () => '00000000-0000-4000-8000-000000000003', hexKey: () => 'c'.repeat(64) } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const mockShareText = jest.fn(async (_message: string, _title: string) => 'shared');
jest.mock('../../../platform/shareText', () => ({ shareText: (m: string, t: string) => mockShareText(m, t) }));

import { HealthSyncSheet } from '../HealthSyncSheet';

beforeEach(() => mockShareText.mockClear());

it('one tap: syncs, makes a 24-hour link to everything and opens the share sheet with it; revocable on the sheet', async () => {
  const server = new FakeHealthServer();
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  render(<HealthSyncSheet store={new KeyValueTrackingStore(new MemoryKeyValue())} onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('health-sync-share-everything')).toBeEnabled());
  expect(screen.getByTestId('health-sync-share')).toHaveTextContent('Advanced sharing');

  fireEvent.press(screen.getByTestId('health-sync-share-everything'));
  await waitFor(() => expect(mockShareText).toHaveBeenCalledTimes(1));
  // No confirmation, category, period or preview step: one upload, one link.
  expect(server.requests.map((q) => `${q.method} ${new URL(q.url).pathname.replace(/[0-9a-f-]{36}/, 'ID')}`)).toEqual([
    'POST /api/body-anvil/v1/enroll',
    'POST /api/body-anvil/v1/users/ID/shares/preview',
    'POST /api/body-anvil/v1/users/ID/shares',
  ]);
  const share = server.shares[0];
  expect(share.scope).toEqual({ range: 'all', categories: ['measurements', 'activity', 'sleep', 'nutrition', 'training', 'plan'], format: 'records', expiresIn: 86400 });
  const [message, title] = mockShareText.mock.calls[0];
  expect(title).toBe('My health data');
  expect(message).toContain(`/api/body-anvil/v1/shared/${share.token}`);
  expect(message).toContain('Read the JSON at this link');
  await waitFor(() => expect(screen.getByTestId('health-sync-notice')).toHaveTextContent('Link ready: all your history, read-only for 24 hours.'));
  expect(screen.getByTestId('everything-link')).toHaveTextContent(/All your history · expires/);

  fireEvent.press(screen.getByTestId('everything-revoke'));
  await waitFor(() => expect(screen.getByTestId('health-sync-notice')).toHaveTextContent('Link revoked'));
  expect(share.revoked).toBe(true);
  expect(screen.queryByTestId('everything-link')).toBeNull();
});

it('a failed sync shares nothing and says so', async () => {
  const server = new FakeHealthServer();
  server.offline = true;
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  render(<HealthSyncSheet store={new KeyValueTrackingStore(new MemoryKeyValue())} onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('health-sync-share-everything')).toBeEnabled());
  fireEvent.press(screen.getByTestId('health-sync-share-everything'));
  await waitFor(() => expect(screen.getByTestId('health-sync-error')).toHaveTextContent(/no link was made\. Couldn’t reach the server/));
  expect(mockShareText).not.toHaveBeenCalled();
  expect(server.shares).toHaveLength(0);
  expect(screen.queryByTestId('everything-link')).toBeNull();
});
