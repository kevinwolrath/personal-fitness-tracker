/** #138: the removed screenshot import's API key is deleted, never read, and never backed up. */
const store = new Map<string, string>();
jest.mock('../secrets', () => ({
  secrets: {
    get: async (k: string) => store.get(k) ?? null,
    set: async (k: string, v: string) => void store.set(k, v),
    remove: async (k: string) => void store.delete(k),
  },
}));

import { BACKUP_PREFERENCE_KEYS, LEGACY_API_KEY, preferences } from '../preferences';

it('forgetScreenshotImportKey deletes the stored key and leaves other preferences alone', async () => {
  store.set(LEGACY_API_KEY, 'sk-fictional-not-a-key');
  store.set('pft.display.energy', 'kcal');
  await preferences.forgetScreenshotImportKey();
  expect(store.has(LEGACY_API_KEY)).toBe(false);
  expect(store.get('pft.display.energy')).toBe('kcal');
  await expect(preferences.forgetScreenshotImportKey()).resolves.toBeUndefined(); // nothing stored: still fine
});

it('the key is never included in backups', () => {
  expect(BACKUP_PREFERENCE_KEYS.included).not.toContain(LEGACY_API_KEY);
  expect(Object.keys(BACKUP_PREFERENCE_KEYS.excluded)).toContain(LEGACY_API_KEY);
});
