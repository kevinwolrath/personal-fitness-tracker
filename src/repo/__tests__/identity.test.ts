import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import app from '../../../app.json';
import { APP_NAME, TAGLINE } from '../../brand';
import { EXPORT_FORMAT } from '../../export/exportFormat';
import { REMINDER_PREFIX } from '../../reminders/schedule';
import { STORAGE_KEY } from '../../storage/keyValueStore';

/**
 * #59: the visible name is Body Anvil; everything that ties existing installs, data, signing and Health Connect
 * to this app keeps its original value. A change here creates a different Play app or orphans user data:
 * it needs Kevin's explicit approval, not a test update.
 */

const source = (path: string) => readFileSync(join(__dirname, '../../..', path), 'utf8');

describe('visible identity', () => {
  it('the app name is Body Anvil, in app.json and in the app', () => {
    expect(APP_NAME).toBe('Body Anvil');
    expect(app.expo.name).toBe(APP_NAME); // launcher label, iOS display name, Health Connect's app list
    expect(TAGLINE).toBe('Hammer Out Your Destiny');
  });

  it('no visible text still uses the old name', () => {
    for (const path of ['src/features/shell/AppShell.tsx', 'src/config/instructions.ts', 'src/onboarding/ai.ts', 'src/config/import/index.ts']) {
      expect(source(path)).not.toMatch(/Personal Fitness Tracker|Fitness tracker:|fitness tracker app/);
    }
  });
});

describe('identifiers that must not change (#59)', () => {
  it('Android package, iOS bundle ID, URL scheme and slug', () => {
    expect(app.expo.android.package).toBe('com.questspire.personalfitnesstracker');
    expect(app.expo.ios.bundleIdentifier).toBe('com.questspire.personalfitnesstracker');
    expect(app.expo.scheme).toBe('personalfitnesstracker');
    expect(app.expo.slug).toBe('personal-fitness-tracker');
  });

  it('the Play release script targets the same package and signing key', () => {
    const script = source('scripts/google-play-release.sh');
    expect(script).toContain('PACKAGE=com.questspire.personalfitnesstracker');
    expect(script).toContain('KEYSTORE=/run/secrets/personal-fitness-tracker-upload.jks');
  });

  it('storage keys and database name', () => {
    expect(STORAGE_KEY).toBe('pft:tracking:v1');
    expect(source('src/storage/openStore.ts')).toContain("openDatabaseAsync('tracking.db')");
    expect(source('src/features/import/useImportSession.ts')).toContain("API_KEY_SECRET = 'pft.anthropic.apiKey'");
    const prefs = source('src/platform/preferences.ts');
    for (const key of ['pft.reminders.enabled', 'pft.display.energy', 'pft.healthConnect.sync', 'pft.setup.draft', 'pft.progress.charts']) {
      expect(prefs).toContain(`'${key}'`);
    }
  });

  it('data formats, the export producer and notification identifiers', () => {
    expect(EXPORT_FORMAT).toBe('pft-export');
    expect(source('src/export/exportFormat.ts')).toContain("app: { name: 'personal-fitness-tracker'");
    expect(source('src/plan/schema.ts')).toContain("format: z.literal('pft-plan')");
    expect(REMINDER_PREFIX).toBe('pft-reminder');
    expect(source('src/platform/notifications.ts')).toContain("const CHANNEL = 'reminders'");
  });
});
