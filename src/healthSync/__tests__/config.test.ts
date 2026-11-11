import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { healthSyncClient, isDevHost, SyncError } from '../client';
import { resolveApiUrl } from '../config';
import { FakeHealthServer } from './fakeServer';

/** #146: the API base URL comes only from the build, is validated, and never falls back to another address. */

describe('resolveApiUrl', () => {
  it('missing or blank: not configured (no default, no fallback)', () => {
    for (const raw of [undefined, '', '   ']) expect(resolveApiUrl(raw, { dev: false })).toMatchObject({ ok: false, problem: 'missing' });
  });

  it('release builds: https only, normalised without a trailing slash', () => {
    expect(resolveApiUrl('https://api.example.test/', { dev: false })).toEqual({ ok: true, url: 'https://api.example.test' });
    expect(resolveApiUrl(' https://api.example.test/base/ ', { dev: false })).toEqual({ ok: true, url: 'https://api.example.test/base' });
    for (const raw of ['http://api.example.test', 'http://localhost:8787', 'http://10.0.2.2:8787', 'http://192.168.1.20:8787'])
      expect(resolveApiUrl(raw, { dev: false })).toMatchObject({ ok: false, problem: 'insecure' });
  });

  it('dev builds may use http to this PC, the emulator alias or a LAN address; never to the internet', () => {
    expect(resolveApiUrl('http://localhost:8787', { dev: true })).toEqual({ ok: true, url: 'http://localhost:8787' });
    expect(resolveApiUrl('http://10.0.2.2:8787', { dev: true })).toEqual({ ok: true, url: 'http://10.0.2.2:8787' });
    expect(resolveApiUrl('http://192.168.1.20:8787', { dev: true })).toEqual({ ok: true, url: 'http://192.168.1.20:8787' });
    expect(resolveApiUrl('http://172.20.0.5:8787', { dev: true })).toMatchObject({ ok: true });
    expect(resolveApiUrl('http://api.example.test', { dev: true })).toMatchObject({ ok: false, problem: 'insecure' });
    expect(resolveApiUrl('http://172.32.0.1', { dev: true })).toMatchObject({ ok: false, problem: 'insecure' });
  });

  it('malformed or unsafe addresses are invalid', () => {
    for (const raw of ['api.example.test', 'not a url', 'ftp://api.example.test', 'https://u:p@api.example.test', 'https://api.example.test?x=1', 'https://api.example.test#a'])
      expect(resolveApiUrl(raw, { dev: true })).toMatchObject({ ok: false });
  });

  it('dev hosts', () => {
    expect(['localhost', '127.0.0.1', '10.0.2.2', '10.1.2.3', '192.168.0.9', '172.16.0.1', '172.31.255.1'].every(isDevHost)).toBe(true);
    expect(['example.com', '8.8.8.8', '172.15.0.1', '192.169.0.1', '11.0.0.1'].some(isDevHost)).toBe(false);
  });
});

describe('the client uses only the configured base', () => {
  it('requests go to <base>/api/body-anvil/v1/…; an unusable base sends nothing', async () => {
    const server = new FakeHealthServer();
    const client = healthSyncClient('https://health.example.test/', server.fetch);
    await expect(client.getSnapshot({ userId: 'u', ownerToken: 't'.repeat(20) })).rejects.toBeInstanceOf(SyncError);
    expect(server.requests[0].url).toBe('https://health.example.test/api/body-anvil/v1/users/u/snapshot');
    const none = healthSyncClient('', server.fetch);
    await expect(none.getSnapshot({ userId: 'u', ownerToken: 't'.repeat(20) })).rejects.toMatchObject({ kind: 'config' });
    const insecure = healthSyncClient('http://localhost:8787', server.fetch); // release build
    await expect(insecure.getSnapshot({ userId: 'u', ownerToken: 't'.repeat(20) })).rejects.toMatchObject({ kind: 'config' });
    expect(server.requests).toHaveLength(1);
  });
});

describe('no hardcoded API address in app code (#146)', () => {
  it('src/ outside tests names no http(s) API base, and reads the URL only in config.ts', () => {
    const root = join(__dirname, '..', '..');
    const files = require('node:child_process')
      .execFileSync('git', ['ls-files', '--', '.'], { cwd: root })
      .toString()
      .split('\n')
      .filter((f: string) => /\.(ts|tsx)$/.test(f) && !f.includes('__tests__'));
    const readers: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(root, f), 'utf8');
      if (text.includes('EXPO_PUBLIC_BODY_ANVIL_API_URL')) readers.push(f);
      expect(text).not.toMatch(/https?:\/\/[^'"`\s]*\/api\/body-anvil/);
      expect(text).not.toMatch(/questspire[a-z.-]*\.(com|dev|app|net|org|io)/i);
    }
    expect(readers).toEqual(['healthSync/config.ts']);
  });
});

describe('errors never reveal the endpoint (#143)', () => {
  const BASE = 'https://private-api.example.test';
  const cred = { userId: 'u', ownerToken: 't'.repeat(20) };
  const reply = (status: number, text = '{}') => async () => ({ status, headers: { get: () => null }, text: async () => text });
  it.each([
    ['offline', async () => { throw new TypeError(`fetch failed for ${BASE}/api/body-anvil/v1/users/u/snapshot`); }],
    ['401', reply(401)],
    ['404', reply(404)],
    ['409', reply(409)],
    ['413', reply(413)],
    ['429', reply(429)],
    ['500', reply(500, `upstream ${BASE} failed`)],
    ['bad JSON', reply(200, `<html>${BASE}</html>`)],
  ])('%s', async (_name, fetchImpl) => {
    const client = healthSyncClient(BASE, fetchImpl as never);
    const err = await client.getSnapshot(cred).catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err.message).not.toMatch(/private-api|example\.test|https?:\/\//);
  });

  it('a missing or invalid configuration message names no address', () => {
    for (const raw of [undefined, 'http://private-api.example.test', 'nonsense']) {
      const r = resolveApiUrl(raw, { dev: false });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).not.toMatch(/private-api|https?:\/\/[a-z]/);
    }
  });
});
