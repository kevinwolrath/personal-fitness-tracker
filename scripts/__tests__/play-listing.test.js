const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {
  validate,
  pngInfo,
  publish,
  sha
} = require('../play-listing');
const { safeFailure } = require('../play-listing');
const { PlayApiError } = require('../google-play-api');
test('authenticated diagnostics expose only controlled operation/status, never response or parser secrets', () => {
  const api = new PlayApiError('Read configured locales', 403, 'private_key=DO-NOT-LOG');
  expect(safeFailure(api)).toContain('Read configured locales failed (HTTP 403)');
  expect(safeFailure(api)).not.toContain('DO-NOT-LOG');
  expect(safeFailure(new SyntaxError('private_key=DO-NOT-LOG'))).not.toContain('DO-NOT-LOG');
});
const canonical = path.resolve(__dirname, '../../store/google-play');
let temporary, fetchOriginal, environment, requests;
beforeAll(() => {
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'body-anvil-listing-'));
});
afterAll(() => {
  if (path.dirname(temporary) === os.tmpdir() && path.basename(temporary).startsWith('body-anvil-listing-')) fs.rmSync(temporary, {
    recursive: true,
    force: true
  });
});
function fixture(change) {
  const dir = fs.mkdtempSync(path.join(temporary, 'case-'));
  fs.cpSync(canonical, dir, {
    recursive: true
  });
  if (change) change(dir);
  return dir;
}
function changeManifest(dir, fn) {
  const p = path.join(dir, 'manifest.json');
  const m = JSON.parse(fs.readFileSync(p));
  fn(m);
  fs.writeFileSync(p, JSON.stringify(m));
}
test('complete checked-in package validates without credentials and preserves package ID', () => {
  const r = validate();
  expect(r.manifest.packageName).toBe(require('../../app.json').expo.android.package);
  expect(r.groups.phoneScreenshots).toHaveLength(4);
});
test.each(['title.txt', 'short-description.txt', 'full-description.txt', 'release-notes.txt'])('rejects oversized %s', file => {
  const dir = fixture(d => fs.writeFileSync(path.join(d, 'en-US', file), 'x'.repeat(4001)));
  expect(() => validate(dir)).toThrow(/characters/);
});
test('rejects unsupported tablet art, duplicate/missing entries and changed pixels', () => {
  for (const change of [m => m.images[0].type = 'tenInchScreenshots', m => m.images.push(m.images[0]), m => m.images.pop(), m => m.images[0].sha256 = '0'.repeat(64)]) {
    expect(() => validate(fixture(d => changeManifest(d, change)))).toThrow();
  }
});
test('rejects dimension lies and incompatible screenshot shape', () => {
  expect(() => validate(fixture(d => changeManifest(d, m => m.images[0].width = 512)))).toThrow(/dimension/);
  const dir = fixture(d => {
    const file = path.join(d, 'en-US/images/phone/01-today.png');
    const b = fs.readFileSync(file);
    b.writeUInt32BE(1, 16);
    fs.writeFileSync(file, b);
    changeManifest(d, m => {
      m.images[0].width = 1;
      m.images[0].sha256 = sha(b);
    });
  });
  expect(() => validate(dir)).toThrow();
});
test('rejects placeholder text, unsafe paths, extra locale, unmanifested imagery and truncated PNG', () => {
  expect(() => validate(fixture(d => fs.writeFileSync(path.join(d, 'en-US/title.txt'), 'TODO')))).toThrow(/placeholder/);
  expect(() => validate(fixture(d => changeManifest(d, m => m.images[0].file = '../../app.json')))).toThrow(/path/);
  expect(() => validate(fixture(d => changeManifest(d, m => m.locales.push('fr-FR'))))).toThrow(/locale/);
  expect(() => validate(fixture(d => fs.mkdirSync(path.join(d, 'fr-FR'))))).toThrow(/directory/);
  expect(() => validate(fixture(d => fs.copyFileSync(path.join(d, 'en-US/images/icon.png'), path.join(d, 'en-US/images/extra.png'))))).toThrow(/Unmanifested/);
  expect(() => pngInfo(fs.readFileSync(path.join(canonical, 'en-US/images/icon.png')).subarray(0, 100))).toThrow(/Truncated|Missing/);
});
describe('publishing transaction', () => {
  beforeEach(() => {
    environment = {
      ...process.env
    };
    fetchOriginal = global.fetch;
    requests = [];
    const {
      privateKey
    } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048
    });
    process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON = JSON.stringify({
      client_email: 'listing-test@example.invalid',
      private_key: privateKey.export({
        type: 'pkcs8',
        format: 'pem'
      })
    });
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE;
    process.env.PLAY_API_TEST_ORIGIN = 'http://127.0.0.1:12345';
    global.fetch = jest.fn(async (url, options = {}) => {
      const u = new URL(url);
      requests.push({
        path: u.pathname,
        query: u.search,
        method: options.method || 'GET',
        body: options.body
      });
      const body = u.pathname === '/token' ? {
        access_token: 'test-token'
      } : u.pathname.endsWith('/edits') ? {
        id: 'test-edit'
      } : u.pathname.endsWith('/details') ? {
        defaultLanguage: 'en-US'
      } : u.pathname.endsWith('/listings') ? {
        listings: [{
          language: 'en-US'
        }]
      } : {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      });
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
    process.env = environment;
    jest.restoreAllMocks();
  });
  test('dry-run uses no credentials or API requests', async () => {
    delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON;
    await publish();
    expect(requests).toEqual([]);
  });
  test('validate-only uploads text and ordered images, validates and deletes without committing', async () => {
    await publish({
      mode: 'validate-only'
    });
    expect(requests.filter(r => r.path.includes('/upload/'))).toHaveLength(6);
    expect(requests.some(r => r.path.endsWith(':validate'))).toBe(true);
    expect(requests.some(r => r.path.endsWith(':commit'))).toBe(false);
    expect(requests.at(-1)).toMatchObject({
      method: 'DELETE'
    });
    expect(requests.find(r => r.method === 'PATCH').body).toContain('Body Anvil');
    expect(requests.find(r => r.method === 'PATCH').path).toMatch(/\/listings\/en-US$/);
    expect(JSON.parse(requests.find(r => r.method === 'PATCH').body).language).toBe('en-US');
    expect(requests.filter(r => r.path.includes('/listings/')).every(r => r.path.includes('/listings/en-US'))).toBe(true);
    expect(requests.some(r => r.method === 'PUT' && /\/listings\//.test(r.path))).toBe(false);
    expect(requests.some(r => r.method !== 'GET' && r.path.endsWith('/details'))).toBe(false);
  });
  test('commit fails closed without approval before authentication', async () => {
    await expect(publish({
      mode: 'commit'
    })).rejects.toThrow(/approval/);
    expect(requests).toEqual([]);
  });
  test('approved listing commit never submits for review or cancels active review', async () => {
    const result = await publish({
      mode: 'commit',
      approved: true,
      track: 'production'
    });
    expect(result.committed).toBe(true);
    const commit = requests.find(r => r.path.endsWith(':commit'));
    expect(commit.query).toContain('changesNotSentForReview=true');
    expect(commit.query).toContain('changesInReviewBehavior=ERROR_IF_IN_REVIEW');
    expect(requests.at(-1)).toBe(commit);
    expect(requests.some(r => r.path.includes('/tracks/'))).toBe(false);
  });
  test('API refusal discards edit and does not retry commit', async () => {
    const original = global.fetch;
    global.fetch = async (url, o) => String(url).includes(':validate') ? new Response(JSON.stringify({
      error: {
        message: 'Rejected'
      }
    }), {
      status: 400
    }) : original(url, o);
    await expect(publish({
      mode: 'commit',
      approved: true
    })).rejects.toThrow(/Validate/);
    expect(requests.at(-1)).toMatchObject({
      method: 'DELETE'
    });
    expect(requests.some(r => r.path.endsWith(':commit'))).toBe(false);
  });
  test.each(['validate-only', 'commit'])('missing existing locale refuses %s without creating or uploading', async mode => {
    const original = global.fetch;
    global.fetch = async (url, o) => String(url).endsWith('/listings') ? new Response(JSON.stringify({
      listings: [{
        language: 'fr-FR'
      }]
    })) : original(url, o);
    await expect(publish({
      mode, approved: true
    })).rejects.toThrow(/en-US/);
    expect(requests.filter(r => r.path.includes('/upload/'))).toHaveLength(0);
    expect(requests.some(r => r.method === 'PATCH' || r.method === 'PUT')).toBe(false);
    expect(requests.at(-1).method).toBe('DELETE');
  });
  test('bundle uploader stages expected version as draft and preserves non-draft releases', async () => {
    const aab = path.join(temporary, 'app.aab');
    fs.writeFileSync(aab, 'test');
    const bundle = require('../upload-play-bundle');
    jest.spyOn(bundle, 'startUpload').mockResolvedValue('test-session');
    jest.spyOn(bundle, 'uploadBundle').mockResolvedValue({
      versionCode: 42
    });
    const original = global.fetch;
    global.fetch = async (url, o) => String(url).endsWith('/tracks/internal') && (!o.method || o.method === 'GET') ? new Response(JSON.stringify({
      releases: [{
        status: 'completed',
        versionCodes: ['40']
      }]
    })) : original(url, o);
    await publish({
      mode: 'validate-only',
      aab,
      versionCode: '42'
    });
    const track = JSON.parse(requests.find(r => r.path.endsWith('/tracks/internal') && r.method === 'PUT').body);
    expect(track.releases[0]).toMatchObject({
      status: 'completed',
      versionCodes: ['40']
    });
    expect(track.releases[1]).toMatchObject({
      status: 'draft',
      versionCodes: ['42'],
      releaseNotes: [{
        language: 'en-US'
      }]
    });
  });
  test.each(['existing draft', 'wrong version'])('bundle refusal cleans up without changing track: %s', async reason => {
    const aab = path.join(temporary, 'refused.aab');
    fs.writeFileSync(aab, 'test');
    const bundle = require('../upload-play-bundle');
    jest.spyOn(bundle, 'startUpload').mockResolvedValue('test-session');
    jest.spyOn(bundle, 'uploadBundle').mockResolvedValue({ versionCode: reason === 'wrong version' ? 41 : 42 });
    const original = global.fetch;
    global.fetch = async (url, options) => String(url).endsWith('/tracks/internal')
      ? new Response(JSON.stringify({ releases: [{ status: 'draft', versionCodes: ['40'] }] }))
      : original(url, options);
    await expect(publish({ mode: 'commit', approved: true, aab, versionCode: '42' })).rejects.toThrow();
    expect(requests.some(r => r.method === 'PUT' && r.path.includes('/tracks/'))).toBe(false);
    expect(requests.some(r => r.path.endsWith(':commit'))).toBe(false);
    expect(requests.at(-1).method).toBe('DELETE');
  });
  test.each([undefined, 'en-GB'])('wrong or absent remote default stops before changing any listing: %s', async defaultLanguage => {
    const original = global.fetch;
    global.fetch = async (url, options) => {
      if (String(url).endsWith('/details')) {
        return new Response(JSON.stringify({ defaultLanguage }));
      }
      return original(url, options);
    };
    await expect(publish({ mode: 'validate-only' })).rejects.toThrow(/default language must be en-US/);
    expect(requests.some(r => r.method === 'PATCH' || r.method === 'PUT')).toBe(false);
    expect(requests.filter(r => r.path.includes('/upload/'))).toHaveLength(0);
    expect(requests.some(r => r.path.endsWith(':commit'))).toBe(false);
    expect(requests.at(-1).method).toBe('DELETE');
  });
  test('production binary commit is refused before API calls', async () => {
    const aab = path.join(temporary, 'app.aab');
    fs.writeFileSync(aab, 'test');
    await expect(publish({
      mode: 'commit',
      approved: true,
      track: 'production',
      aab,
      versionCode: '42'
    })).rejects.toThrow(/disabled/);
    expect(requests).toEqual([]);
  });
});
