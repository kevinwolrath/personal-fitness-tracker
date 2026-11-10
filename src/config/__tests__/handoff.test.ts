/** #120 PoC: a configuration update carried in a link is read, then goes through the normal importer. */
import { readFileSync } from 'node:fs';
import seed from '../../../plans/seed.plan.json';
import { CONFIG_LINK_MAX_CHARS, buildConfigLink, readConfigLink } from '../handoff';
import { applyConfigUpdate, parseConfigUpdate } from '../update';

const fixture = (name: string) => JSON.stringify(JSON.parse(readFileSync(`fixtures/config/${name}.update.json`, 'utf8')));
/** What expo-router hands the screen: the query params of the opened URL, percent-decoded once. */
const open = (url: string) => {
  const q = new URL(url.replace(/^personalfitnesstracker:\/\//, 'https://x/')).searchParams;
  return { update: q.get('update') ?? undefined, v: q.get('v') ?? undefined };
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

it('round-trips an update through a link into the normal importer, unchanged', () => {
  const json = fixture('lunch');
  const link = buildConfigLink(json);
  expect(link.startsWith('personalfitnesstracker://configure?v=1&update=%7B')).toBe(true);
  const r = readConfigLink(open(link));
  expect(r).toEqual({ ok: true, text: json });
  const parsed = parseConfigUpdate((r as { text: string }).text);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(applyConfigUpdate(clone(seed), parsed.update).ok).toBe(true);
});

it('measures the payload: URL-encoding costs well under 2× the JSON length', () => {
  const sizes = Object.fromEntries(['lunch', 'nutrition', 'combined', 'real-world-exercise', 'daily-prescription'].map((n) => [n, { json: fixture(n).length, link: buildConfigLink(fixture(n)).length }]));
  // Recorded in docs/config-link-poc.md: URL-encoding roughly 1.3–1.6× the JSON length.
  expect(sizes.lunch.json).toBeLessThan(CONFIG_LINK_MAX_CHARS);
  for (const s of Object.values(sizes)) expect(s.link / s.json).toBeGreaterThan(1.1);
  expect(sizes.lunch.link / sizes.lunch.json).toBeLessThan(2);
});

it('no update param: not a configuration link', () => {
  expect(readConfigLink({})).toBeNull();
});

it('rejects empty, repeated, too long and unknown-version links with a plain message', () => {
  expect(readConfigLink({ update: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/empty/) });
  expect(readConfigLink({ update: ['{}', '{}'] })).toMatchObject({ ok: false, error: expect.stringMatching(/more than one/) });
  expect(readConfigLink({ update: '{' + ' '.repeat(CONFIG_LINK_MAX_CHARS) + '}' })).toMatchObject({ ok: false, error: expect.stringMatching(/too long/) });
  expect(readConfigLink({ update: '{}', v: '2' })).toMatchObject({ ok: false, error: expect.stringMatching(/v=2/) });
});

it('reads a link that was percent-encoded twice; bad encoding is an error', () => {
  const json = fixture('lunch');
  expect(readConfigLink({ update: encodeURIComponent(json) })).toEqual({ ok: true, text: json });
  expect(readConfigLink({ update: '%7B%E0%A4%A' })).toMatchObject({ ok: false, error: expect.stringMatching(/bad encoding/) });
});

it('a tampered update is rejected by the normal importer, never applied', () => {
  const tampered = fixture('lunch').replace('"schemaVersion":1', '"schemaVersion":1,"evil":{"__proto__":{"x":1}}');
  const r = readConfigLink(open(buildConfigLink(tampered)));
  expect(r?.ok).toBe(true);
  expect(parseConfigUpdate((r as { text: string }).text).ok).toBe(false);
  const truncated = buildConfigLink(fixture('lunch')).slice(0, 120);
  const t = readConfigLink(open(truncated));
  expect(t?.ok && parseConfigUpdate((t as { text: string }).text).ok).toBe(false);
});
