const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PNG } = require('pngjs');
const { ROOT, validate } = require('../play-listing.cjs');
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'play-listing-')); fs.cpSync(ROOT, dir, { recursive: true }); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
function changeManifest(fn) { const p = path.join(dir, 'manifest.json'), m = JSON.parse(fs.readFileSync(p)); fn(m); fs.writeFileSync(p, JSON.stringify(m)); }
function png(name, width, height, alpha = 255) { const p = new PNG({ width, height }); p.data.fill(alpha); fs.writeFileSync(path.join(dir, 'en-AU/images', name), PNG.sync.write(p, { colorType: name === 'icon.png' ? 6 : 2 })); }
test('committed listing is complete, decodable and Play-sized', () => {
  const result = validate(); expect(result.manifest.packageName).toBe('com.questspire.personalfitnesstracker');
  expect(result.locales[0].images.phoneScreenshots.map(i => [i.width, i.height])).toEqual([[1170,2340],[1170,2340],[1170,2340]]);
});
test.each([
  ['text limit', () => fs.writeFileSync(path.join(dir,'en-AU/title.txt'), 'a'.repeat(31)), /characters/],
  ['missing text', () => fs.unlinkSync(path.join(dir,'en-AU/full-description.txt')), /ENOENT/],
  ['identity', () => changeManifest(m => m.packageName = 'other.app'), /identity/],
  ['locale completeness', () => changeManifest(m => m.locales.push('en-US')), /ENOENT/],
  ['missing imagery', () => changeManifest(m => delete m.images.featureGraphic), /exactly/],
  ['count', () => changeManifest(m => m.images.phoneScreenshots = []), /count/],
  ['icon size', () => png('icon.png', 64, 64), /512/],
  ['feature size', () => png('feature-graphic.png', 512, 512), /1024/],
  ['alpha', () => png('icon.png', 512,512,0), /Transparent/],
  ['aspect ratio', () => png('phoneScreenshots/01-daily-log.png', 390,844), /twice/],
  ['truncated PNG', () => fs.writeFileSync(path.join(dir,'en-AU/images/icon.png'), Buffer.from('broken')), /Invalid PNG/],
  ['path traversal', () => changeManifest(m => m.images.icon = ['../../package.json']), /PNG|escapes/],
  ['duplicate screenshot', () => changeManifest(m => m.images.phoneScreenshots[1] = m.images.phoneScreenshots[0]), /Duplicate/],
])('rejects %s', (_, action, message) => { action(); expect(() => validate(dir)).toThrow(message); });
