#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PNG } = require('pngjs');
const ROOT = path.resolve(__dirname, '../store/google-play');
const PACKAGE = 'com.questspire.personalfitnesstracker';
const TEXT = { title: 30, 'short-description': 80, 'full-description': 4000, 'release-notes': 500 };
function assert(ok, message) { if (!ok) throw new Error(message); }
function readInside(root, name) {
  assert(typeof name === 'string' && name.length > 0, 'Missing asset path');
  const target = path.resolve(root, name);
  assert(target.startsWith(path.resolve(root) + path.sep), 'Asset escapes listing directory: ' + name);
  const real = fs.realpathSync(target);
  assert(real.startsWith(fs.realpathSync(root) + path.sep), 'Asset symlink escapes listing directory');
  assert(fs.statSync(real).isFile(), 'Expected a file: ' + name);
  return fs.readFileSync(real);
}
function validate(root = ROOT) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert(manifest.schemaVersion === 1 && manifest.packageName === PACKAGE, 'Unexpected manifest version or package identity');
  assert(manifest.defaultLocale === 'en-AU', 'en-AU must remain the baseline locale');
  assert(Array.isArray(manifest.locales) && manifest.locales.includes('en-AU') && new Set(manifest.locales).size === manifest.locales.length, 'Missing or duplicate locales');
  assert(manifest.locales.every(l => ['en-AU', 'en-US'].includes(l)), 'Unsupported locale; explicitly document and implement it first');
  const allowed = ['icon', 'featureGraphic', 'phoneScreenshots'];
  assert(manifest.images && Object.keys(manifest.images).sort().join() === allowed.sort().join(), 'Manifest must declare exactly icon, featureGraphic and phoneScreenshots');
  const locales = [];
  for (const locale of manifest.locales) {
    const dir = path.join(root, locale), text = {}, images = {};
    for (const [key, limit] of Object.entries(TEXT)) {
      const value = readInside(dir, key + '.txt').toString('utf8').trim();
      assert(value.length > 0 && [...value].length <= limit, `${locale}/${key}: must contain 1–${limit} characters`);
      assert(!/\b(TODO|PLACEHOLDER|Lorem ipsum)\b/i.test(value) && !value.includes('\uFFFD'), `Unfinished or invalid text: ${key}`);
      text[key] = value;
    }
    const seen = new Set();
    for (const type of allowed) {
      const names = manifest.images[type];
      assert(Array.isArray(names) && (type === 'phoneScreenshots' ? names.length >= 2 && names.length <= 8 : names.length === 1), `Invalid ${type} count`);
      images[type] = names.map(name => {
        assert(!seen.has(name), 'Duplicate image: ' + name); seen.add(name);
        assert(name.endsWith('.png'), 'This package accepts PNG assets only');
        const bytes = readInside(dir, name);
        assert(bytes.length < 8 * 1024 * 1024, 'Image must be smaller than 8 MiB: ' + name);
        let png;
        try { png = PNG.sync.read(bytes, { checkCRC: true }); } catch { throw new Error('Invalid PNG: ' + name); }
        assert(bytes[24] === 8 && [2, 6].includes(bytes[25]), 'Use 8-bit RGB/RGBA PNG: ' + name);
        const { width: w, height: h } = png;
        assert(bytes[25] === (type === 'icon' ? 6 : 2), type === 'icon' ? 'Icon must be 32-bit RGBA PNG' : 'Feature graphic and screenshots must be 24-bit RGB PNG without alpha');
        if (type === 'icon') assert(w === 512 && h === 512 && bytes.length <= 1024 * 1024, 'Icon must be 512×512 and at most 1 MiB');
        if (type === 'featureGraphic') assert(w === 1024 && h === 500, 'Feature graphic must be 1024×500');
        if (type === 'phoneScreenshots') assert(Math.min(w, h) >= 320 && Math.max(w, h) <= 3840 && Math.max(w, h) <= 2 * Math.min(w, h), 'Phone screenshots: 320–3840 pixels, longest side at most twice shortest');
        // Play requires an opaque icon and feature graphic. Enforce opacity everywhere.
        for (let i = 3; i < png.data.length; i += 4) {
          if (png.data[i] !== 255) throw new Error('Transparent pixel in ' + name);
        }
        return { name, bytes, width: w, height: h, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      });
    }
    const hashes = images.phoneScreenshots.map(i => i.sha256);
    assert(new Set(hashes).size === hashes.length, 'Duplicate phone screenshot content');
    locales.push({ locale, text, images });
  }
  return { manifest, locales };
}
function summary(bundle) {
  return { packageName: bundle.manifest.packageName, defaultLocale: bundle.manifest.defaultLocale, locales: bundle.locales.map(l => ({ locale: l.locale, textLengths: Object.fromEntries(Object.entries(l.text).map(([k, v]) => [k, [...v].length])), images: Object.fromEntries(Object.entries(l.images).map(([k, files]) => [k, files.map(({ name, width, height, sha256 }) => ({ name, width, height, sha256 }))])) })) };
}
if (require.main === module) {
  try { console.log(JSON.stringify(summary(validate(process.argv[2] || ROOT)), null, 2)); }
  catch (error) { console.error('[play-listing] ' + error.message); process.exitCode = 1; }
}
module.exports = { ROOT, PACKAGE, validate, summary };
