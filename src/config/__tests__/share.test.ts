/** #119 Configure with AI: the one payload shared (or copied) with an assistant. */
import seed from '../../../plans/seed.plan.json';
import { CONFIG_SHARE_FORMAT, buildConfigShare } from '../instructions';
import { CONFIG_SCHEMA_VERSION, readConfig, type RawPlan } from '../sections';
import { parseConfigUpdate } from '../update';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
/** Read the snapshot with the update grammar, using the update delimiters for the test. */
function currentConfig(text: string) {
  const snapshot = text.match(/^BODY ANVIL CURRENT CONFIGURATION v\d+\n[\s\S]*?^END CURRENT CONFIGURATION$/m)?.[0];
  const parsed = parseConfigUpdate(snapshot!.replaceAll('CURRENT CONFIGURATION', 'UPDATE'));
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.update.sections;
}

describe('buildConfigShare', () => {
  it('starts with a versioned header naming the share format and configuration schema version', () => {
    const text = buildConfigShare(clone(seed), '2026-11-02');
    expect(text.split('\n')[0]).toBe(`Body Anvil configuration share · format ${CONFIG_SHARE_FORMAT} · configuration schema version ${CONFIG_SCHEMA_VERSION}`);
    expect(text).toContain(`Configuration schema version: ${CONFIG_SCHEMA_VERSION}.`);
    expect(text).toContain('Today is 2026-11-02.');
  });

  it('carries the actual persisted configuration, every section, exactly', () => {
    const raw: RawPlan = clone(seed);
    raw.profile = { ...(raw.profile ?? {}), displayName: 'Test Person', heightCm: 181 };
    const shared = currentConfig(buildConfigShare(raw, '2026-11-02'));
    expect(shared).toEqual(JSON.parse(JSON.stringify(readConfig(raw))));
    expect(shared.profile?.displayName).toBe('Test Person');
  });

  it('missing optional values are left out, never invented', () => {
    const raw: RawPlan = clone(seed);
    delete raw.exercise;
    delete raw.profile;
    const shared = currentConfig(buildConfigShare(raw, '2026-11-02'));
    expect(shared.exercise).toBeUndefined();
    expect(shared.profile?.heightCm).toBeUndefined();
    expect(JSON.stringify(shared)).not.toContain('null');
  });

  it('is deterministic for the same plan and date (the preview is what is shared)', () => {
    expect(buildConfigShare(clone(seed), '2026-11-02')).toBe(buildConfigShare(clone(seed), '2026-11-02'));
  });

  it('states the app owns the configuration, applies nothing without confirmation and must not guess health limits', () => {
    const text = buildConfigShare(clone(seed), '2026-11-02');
    expect(text).toContain('Nothing changes in the app until I paste your update back into it, review the preview and confirm.');
    expect(text).toContain('The app owns my configuration.');
    expect(text).toMatch(/don't guess about health limits, equipment or food/);
  });

  it('contains no history, records, secrets or provider-specific targets', () => {
    const text = buildConfigShare(clone(seed), '2026-11-02');
    for (const s of ['configChanges', 'observations', 'apiKey', 'api_key', 'sk-ant', 'chatgpt.com', 'claude.ai', 'intent://']) expect(text).not.toContain(s);
  });

  it('its text examples pass the same importer', () => {
    const text = buildConfigShare(clone(seed), '2026-11-02');
    const examples = text.match(/^BODY ANVIL UPDATE v\d+\n[\s\S]*?^END UPDATE$/gm) ?? [];
    expect(examples.length).toBeGreaterThan(3);
    for (const e of examples) expect(parseConfigUpdate(e).ok).toBe(true);
  });
});
