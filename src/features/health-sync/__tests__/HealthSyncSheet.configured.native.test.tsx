import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KeyValueTrackingStore, MemoryKeyValue } from '../../../storage/keyValueStore';
import { FakeHealthServer } from '../../../healthSync/__tests__/fakeServer';

/**
 * #143: with a valid bundled API URL, Sync my data works with no setup; the endpoint is never shown or editable;
 * View the server copy turns on once linked; an unreachable server gives a clear error without the address.
 */
const API = 'https://health.example.test';
jest.mock('../../../healthSync/config', () => ({
  BUILD_API: { ok: true, url: 'https://health.example.test' },
  BUILD_ENROLLMENT_KEY: 'e'.repeat(64),
  DEV_BUILD: false,
}));
jest.mock('../../../platform/secrets', () => {
  const map = new Map<string, string>();
  return { secrets: { get: async (k: string) => map.get(k) ?? null, set: async (k: string, v: string) => void map.set(k, v), remove: async (k: string) => void map.delete(k) } };
});
jest.mock('../../../platform/random', () => ({ random: { uuid: () => '00000000-0000-4000-8000-000000000002', hexKey: () => 'c'.repeat(64) } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

import { HealthSyncSheet } from '../HealthSyncSheet';

const noEndpointShown = () => {
  expect(screen.queryByText(/health\.example\.test|https?:\/\//)).toBeNull();
  expect(screen.queryByTestId('health-sync-url')).toBeNull();
  expect(screen.queryByLabelText('Server address')).toBeNull();
  expect(screen.queryByText(/server address/i)).toBeNull();
};

it('bundled URL: sync is available with no setup, links, then View the server copy is enabled; no endpoint shown', async () => {
  const server = new FakeHealthServer();
  (globalThis as { fetch: unknown }).fetch = server.fetch;
  render(<HealthSyncSheet store={new KeyValueTrackingStore(new MemoryKeyValue())} onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('health-sync-link-state')).toHaveTextContent('Your first sync links this phone to the server.'));
  expect(screen.getByTestId('health-sync-prepare')).toBeEnabled();
  expect(screen.getByTestId('health-sync-share')).toBeEnabled();
  expect(screen.getByTestId('health-sync-view')).toBeDisabled(); // nothing on the server yet
  noEndpointShown();

  fireEvent.press(screen.getByTestId('health-sync-prepare'));
  fireEvent.press(await screen.findByTestId('health-sync-upload'));
  await waitFor(() => expect(screen.getByTestId('health-sync-notice')).toHaveTextContent('Linked and uploaded'));
  expect(screen.getByTestId('health-sync-view')).toBeEnabled();
  expect(server.requests[0].url.startsWith(`${API}/api/body-anvil/v1/`)).toBe(true);
  noEndpointShown();
});

it('unreachable server: a clear error that never includes the address', async () => {
  (globalThis as { fetch: unknown }).fetch = async () => {
    throw new TypeError(`Network request failed: ${API}/api/body-anvil/v1/enroll`);
  };
  render(<HealthSyncSheet store={new KeyValueTrackingStore(new MemoryKeyValue())} onClose={() => undefined} />);
  await waitFor(() => expect(screen.getByTestId('health-sync-prepare')).toBeEnabled());
  fireEvent.press(screen.getByTestId('health-sync-prepare'));
  fireEvent.press(await screen.findByTestId('health-sync-upload'));
  await waitFor(() => expect(screen.getByTestId('health-sync-error')).toHaveTextContent(/Couldn’t reach the server/));
  noEndpointShown();
});
