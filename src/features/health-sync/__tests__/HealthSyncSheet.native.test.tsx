import { render, screen, waitFor } from '@testing-library/react-native';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';

/** #146: a build without a valid API URL turns sync and sharing off, says why, and offers no address field. */
jest.mock('../../../healthSync/config', () => ({
  BUILD_API: { ok: false, problem: 'missing', message: 'This version of the app has no sync server configured, so syncing and sharing are off.' },
  BUILD_ENROLLMENT_KEY: 'e'.repeat(64),
  DEV_BUILD: false,
}));
jest.mock('../../../platform/secrets', () => {
  const map = new Map<string, string>();
  return { secrets: { get: async (k: string) => map.get(k) ?? null, set: async (k: string, v: string) => void map.set(k, v), remove: async (k: string) => void map.delete(k) } };
});
jest.mock('../../../platform/random', () => ({ random: { uuid: () => '00000000-0000-4000-8000-000000000001', hexKey: () => 'c'.repeat(64) } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

import { HealthSyncSheet } from '../HealthSyncSheet';

it('no API URL in the build: explained, sync and share disabled, no request, no address field', async () => {
  const fetchSpy = jest.fn();
  (globalThis as { fetch: unknown }).fetch = fetchSpy;
  render(<HealthSyncSheet store={new KeyValueTrackingStore(new MemoryKeyValue())} onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('health-sync-link-state')).toHaveTextContent(/no sync server configured/));
  expect(screen.getByTestId('health-sync-prepare')).toBeDisabled();
  expect(screen.getByTestId('health-sync-share')).toBeDisabled();
  expect(screen.queryByTestId('health-sync-url')).toBeNull();
  expect(screen.queryByLabelText('Server address')).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
});
