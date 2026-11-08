#!/usr/bin/env node
"use strict";

// Offline validation is the default. Credentials are read only for validate-only/commit.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ROOT = path.resolve(__dirname, '..');
const PACKAGE = 'com.questspire.personalfitnesstracker';
const LOCALE = 'en-US';
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const crcTable = Array.from({
  length: 256
}, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ n >>> 1 : n >>> 1;
  return n >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ c >>> 8;
  return (c ^ 0xffffffff) >>> 0;
}
class ListingValidationError extends Error {}
function assert(ok, message) {
  if (!ok) throw new ListingValidationError(message);
}
function safeFailure(error) {
  if (error instanceof ListingValidationError) return error.message;
  const { PlayApiError } = require('./google-play-api');
  if (error instanceof PlayApiError) {
    const operation = /^[A-Za-z0-9 -]{1,80}$/.test(error.operation || '') ? error.operation : 'Play API request';
    return operation + ' failed (HTTP ' + error.status + '). Check app permissions and Play Console; API response omitted.';
  }
  return 'Play listing failed. Check credentials, locale permissions and Play Console pending changes. Credential/parser/API response details omitted.';
}
function pngInfo(b) {
  assert(b.length > 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Invalid PNG signature');
  assert(b.toString('ascii', 12, 16) === 'IHDR' && b.readUInt32BE(8) === 13, 'Invalid PNG header');
  const width = b.readUInt32BE(16),
    height = b.readUInt32BE(20),
    depth = b[24],
    color = b[25];
  assert(width > 0 && height > 0 && width <= 3840 && height <= 3840, 'PNG dimensions out of bounds');
  assert(depth === 8 && [2, 6].includes(color) && b[26] === 0 && b[27] === 0 && b[28] === 0, 'Expected non-interlaced RGB/RGBA 8-bit PNG');
  const idat = [];
  let end = false;
  for (let p = 8; p < b.length;) {
    assert(p + 12 <= b.length, 'Truncated PNG chunk');
    const size = b.readUInt32BE(p);
    assert(p + 12 + size <= b.length, 'Truncated PNG data');
    assert(crc32(b.subarray(p + 4, p + 8 + size)) === b.readUInt32BE(p + 8 + size), 'Invalid PNG chunk checksum');
    const type = b.toString('ascii', p + 4, p + 8);
    assert(type !== 'tRNS', 'PNG transparency chunks are not supported');
    if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + size));
    if (type === 'IEND') {
      end = true;
      assert(p + 12 === b.length, 'Unexpected trailing PNG data');
      break;
    }
    p += size + 12;
  }
  assert(end && idat.length, 'Missing PNG image data');
  const stride = width * (color === 6 ? 4 : 3) + 1;
  const raw = zlib.inflateSync(Buffer.concat(idat), {
    maxOutputLength: stride * height
  });
  assert(raw.length === stride * height, 'Invalid PNG decoded size');
  for (let y = 0; y < height; y++) assert(raw[y * stride] <= 4, 'Invalid PNG filter');
  return {
    width,
    height,
    color
  };
}
function validate(root = path.join(ROOT, 'store/google-play')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert(manifest.schemaVersion === 1 && manifest.packageName === PACKAGE, 'Listing manifest identity/schema mismatch');
  assert(require(path.join(ROOT, 'app.json')).expo.android.package === PACKAGE, 'Expo package identity changed');
  assert(manifest.defaultLocale === LOCALE && JSON.stringify(manifest.locales) === JSON.stringify([LOCALE]), 'Only reviewed en-US locale is configured');
  const localeDirectories = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);
  assert(localeDirectories.length === 1 && localeDirectories[0] === LOCALE, 'Only the canonical en-US listing directory is allowed');
  const base = path.join(root, LOCALE);
  const text = {};
  for (const [key, file, max] of [['title', 'title.txt', 30], ['shortDescription', 'short-description.txt', 80], ['fullDescription', 'full-description.txt', 4000], ['releaseNotes', 'release-notes.txt', 500]]) {
    const value = fs.readFileSync(path.join(base, file), 'utf8').trim();
    assert(value.length > 0 && [...value].length <= max, `${file}: expected 1–${max} characters`);
    assert(!/\b(TODO|TBD|Lorem ipsum)\b|Expo boilerplate/i.test(value), `${file}: placeholder copy`);
    text[key] = value;
  }
  assert(text.title === 'Body Anvil', 'Unexpected store title');
  assert(Array.isArray(manifest.images), 'Missing image manifest');
  const seen = new Set(),
    groups = {};
  for (const image of manifest.images) {
    assert(['icon', 'featureGraphic', 'phoneScreenshots'].includes(image.type), 'Unsupported image type: no unverified tablet imagery');
    assert(typeof image.file === 'string' && /^en-US\/images\/[a-z0-9/-]+\.png$/.test(image.file), 'Invalid image path');
    assert(!seen.has(image.file), 'Duplicate image path');
    seen.add(image.file);
    assert(typeof image.alt === 'string' && image.alt.trim().length > 0 && typeof image.source === 'string' && image.source.length > 0, 'Missing image source/alt');
    const bytes = fs.readFileSync(path.join(root, image.file));
    const info = pngInfo(bytes);
    assert(sha(bytes) === image.sha256, 'Image checksum mismatch: ' + image.file);
    assert(info.width === image.width && info.height === image.height, 'Manifest dimension mismatch: ' + image.file);
    assert(bytes.length <= 8 * 1024 * 1024, 'Image exceeds project 8 MiB limit');
    if (image.type === 'icon') assert(info.width === 512 && info.height === 512 && info.color === 6 && bytes.length <= 1024 * 1024, 'Icon must be 512×512 RGBA PNG, ≤1 MiB');
    if (image.type === 'featureGraphic') assert(info.width === 1024 && info.height === 500 && info.color === 2, 'Feature graphic must be 1024×500 RGB PNG');
    if (image.type === 'phoneScreenshots') assert(info.color === 2 && Math.min(info.width, info.height) >= 320 && Math.max(info.width, info.height) <= 2 * Math.min(info.width, info.height), 'Invalid phone screenshot dimensions/alpha');
    (groups[image.type] ??= []).push(image);
  }
  assert(groups.icon?.length === 1 && groups.featureGraphic?.length === 1, 'Exactly one icon and feature graphic required');
  assert(groups.phoneScreenshots?.length >= 2 && groups.phoneScreenshots.length <= 8, 'Need 2–8 phone screenshots');
  const disk = fs.readdirSync(path.join(base, 'images'), {
    recursive: true
  }).filter(f => fs.statSync(path.join(base, 'images', f)).isFile()).map(f => 'en-US/images/' + f.replaceAll('\\', '/'));
  assert(disk.length === seen.size && disk.every(f => seen.has(f)), 'Unmanifested or missing PNG files');
  assert(manifest.capture?.engine === 'playwright-production-web' && /^[a-f0-9]{40}$/.test(manifest.capture.sourceCommit), 'Missing screenshot provenance');
  return {
    manifest,
    text,
    groups,
    root
  };
}
async function publish({
  mode = 'dry-run',
  track = 'internal',
  aab,
  versionCode,
  approved = false,
  root
} = {}) {
  assert(['dry-run', 'validate-only', 'commit'].includes(mode), 'Invalid mode');
  assert(['internal', 'alpha', 'beta', 'production'].includes(track), 'Invalid track');
  const listing = validate(root);
  assert(!aab || /^[1-9][0-9]*$/.test(String(versionCode)) && fs.statSync(aab).isFile(), 'AAB requires a file and positive expected versionCode');
  // Listing changes are app-wide even when the selected binary track is internal.
  assert(mode !== 'commit' || approved, 'Committed changes require explicit protected-environment approval');
  assert(!(mode === 'commit' && track === 'production' && aab), 'Production binary publication is disabled; stage/promote manually in Play Console');
  const summary = {
    mode,
    track,
    packageName: PACKAGE,
    locale: LOCALE,
    images: listing.manifest.images.length,
    bundle: !!aab,
    committed: false
  };
  if (mode === 'dry-run') {
    console.log(JSON.stringify(summary));
    return summary;
  }
  const {
    endpoints,
    requestJson,
    getAccessToken
  } = require('./google-play-api');
  const credentials = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE ? JSON.parse(fs.readFileSync(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_FILE, 'utf8')) : JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '{}');
  const token = await getAccessToken(credentials, PACKAGE);
  console.log('[play-listing] Authentication succeeded.');
  const {
    apiRoot,
    uploadRoot
  } = endpoints(PACKAGE);
  const auth = {
    authorization: 'Bearer ' + token,
    'content-type': 'application/json'
  };
  const edit = await requestJson(apiRoot + '/edits', {
    method: 'POST',
    headers: auth,
    body: '{}'
  }, 'Create listing edit');
  assert(edit.id, 'Missing edit ID');
  const er = apiRoot + '/edits/' + encodeURIComponent(edit.id);
  try {
    // Inspect only: never create a translation or change the app's default language.
    const details = await requestJson(er + '/details', { headers: auth }, 'Read app default language');
    assert(details.defaultLanguage === LOCALE, 'Existing Google Play default language must be en-US; no locale changes made');
    const remote = await requestJson(er + '/listings', {
      headers: auth
    }, 'Read configured locales');
    assert(remote.listings?.some(l => l.language === LOCALE), 'Existing en-US default listing is missing; no locale created');
    await requestJson(er + '/listings/' + LOCALE, {
      method: 'PATCH',
      headers: auth,
      body: JSON.stringify({
        language: LOCALE,
        title: listing.text.title,
        shortDescription: listing.text.shortDescription,
        fullDescription: listing.text.fullDescription
      })
    }, 'Update en-US text');
    console.log('[play-listing] Existing en-US default listing confirmed and text staged.');
    for (const [type, images] of Object.entries(listing.groups)) {
      await requestJson(er + '/listings/' + LOCALE + '/' + type, {
        method: 'DELETE',
        headers: auth
      }, 'Replace ' + type);
      for (const image of images) await requestJson(uploadRoot + '/edits/' + encodeURIComponent(edit.id) + '/listings/' + LOCALE + '/' + type + '?uploadType=media', {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + token,
          'content-type': 'image/png'
        },
        body: fs.readFileSync(path.join(listing.root, image.file))
      }, 'Upload ' + type);
    }
    if (aab) {
      const {
        startUpload,
        uploadBundle
      } = require('./upload-play-bundle');
      const size = fs.statSync(aab).size;
      const session = await startUpload(uploadRoot, edit.id, token, size);
      const bundle = await uploadBundle(session, aab, size);
      assert(String(bundle.versionCode) === String(versionCode), 'AAB versionCode differs from expected value');
      // Drafts only. Never replace a live track release from this listing tool.
      const current = await requestJson(er + '/tracks/' + track, {
        headers: auth
      }, 'Read target track');
      assert(!(current.releases || []).some(r => r.status === 'draft'), 'Existing draft release requires manual reconciliation before uploading another');
      const releases = current.releases || [];
      releases.push({
        name: 'Body Anvil ' + versionCode,
        versionCodes: [String(versionCode)],
        status: 'draft',
        releaseNotes: [{
          language: LOCALE,
          text: listing.text.releaseNotes
        }]
      });
      await requestJson(er + '/tracks/' + track, {
        method: 'PUT',
        headers: auth,
        body: JSON.stringify({
          track,
          releases
        })
      }, 'Stage draft bundle');
    }
    await requestJson(er + ':validate', {
      method: 'POST',
      headers: auth
    }, 'Validate listing edit');
    if (mode === 'commit') {
      await requestJson(er + ':commit?changesNotSentForReview=true&changesInReviewBehavior=ERROR_IF_IN_REVIEW', {
        method: 'POST',
        headers: auth
      }, 'Commit without sending for review');
      summary.committed = true;
    }
    console.log(JSON.stringify(summary));
    return summary;
  } finally {
    if (!summary.committed) {
      const r = await fetch(er, {
        method: 'DELETE',
        headers: auth
      });
      assert(r.ok || r.status === 404, 'Could not discard edit; inspect Play Console before retrying');
      console.log('[play-listing] Temporary edit discarded; no commit or review submission.');
    }
  }
}
if (require.main === module) {
  const args = process.argv.slice(2);
  const value = key => {
    const i = args.indexOf(key);
    return i < 0 ? undefined : args[i + 1];
  };
  publish({
    mode: value('--mode'),
    track: value('--track'),
    aab: value('--aab'),
    versionCode: value('--version-code'),
    approved: process.env.PLAY_PUBLISH_APPROVED === 'true'
  }).catch(error => {
    // API responses and credential parsing errors are intentionally not echoed into CI logs.
    console.error((value('--mode') || 'dry-run') === 'dry-run' ? error.message : safeFailure(error));
    process.exitCode = 1;
  });
}
module.exports = {
  validate,
  pngInfo,
  publish,
  safeFailure,
  sha,
  PACKAGE,
  LOCALE
};
