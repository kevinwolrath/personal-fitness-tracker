#!/usr/bin/env node
'use strict';
// Render authored brand layouts and capture the real running app; no invented UI or personal seed data.
const fs = require('node:fs');
const path = require('node:path');
const { chromium, expect } = require('@playwright/test');
const { PNG } = require('pngjs');
const { ROOT, validate } = require('./play-listing.cjs');
const root = path.resolve(__dirname, '..');
const mark = `<svg viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg"><path fill="#FF9E42" d="M28 55h264v35l-66 34h-34v53l46 28v24H80v-24l47-28v-53H94L28 90z"/><path fill="#FFBD72" d="M28 55h264v15H28z"/><path fill="#101519" d="m145 10 10 25-10 25-10-25zM184 0l8 20-8 20-8-20z"/></svg>`;
async function main() {
  const screenshots = process.argv.includes('--screenshots');
  const graphics = process.argv.includes('--graphics');
  if (!screenshots && !graphics) throw new Error('Choose --graphics and/or --screenshots');
  const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    const imageDir = path.join(ROOT, 'en-AU/images');
    fs.mkdirSync(path.join(imageDir, 'phoneScreenshots'), { recursive: true });
    if (graphics) {
      const page = await browser.newPage({ deviceScaleFactor: 1 });
      for (const [name, width, height, html] of [
        ['icon',512,512,`<div style="width:380px">${mark}</div>`],
        ['feature-graphic',1024,500,`<div style="width:310px">${mark}</div><div><p style="color:#FF9E42;font-size:17px;letter-spacing:5px">YOUR DAILY FITNESS LOG</p><h1 style="font-size:70px;letter-spacing:-3px;margin:14px 0">Body Anvil</h1><p style="font-size:23px;color:#B5BDC4">Train. Track. Build your routine.</p></div>`],
      ]) {
        await page.setViewportSize({ width, height });
        await page.setContent(`<body style="margin:0;background:#101519;color:#F1F3F4;font-family:Arial,sans-serif;display:flex;gap:36px;align-items:center;justify-content:center;height:100vh;box-sizing:border-box;border:12px solid #20272D">${html}</body>`);
        const bytes = await page.screenshot({ omitBackground: false });
        // Play specifies a 32-bit PNG icon and a 24-bit, alpha-free feature graphic.
        fs.writeFileSync(path.join(imageDir, name + '.png'), PNG.sync.write(PNG.sync.read(bytes), { colorType: name === 'icon' ? 6 : 2 }));
      }
      await page.close();
    }
    if (screenshots) {
      // Google Play max aspect ratio is 2:1; use a real 390×780 viewport, not a cropped phone.
      const context = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-AU', timezoneId: 'Australia/Melbourne' });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      const plan = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/plans/generic-example.plan.json'), 'utf8'));
      const observations = JSON.parse(fs.readFileSync(path.join(ROOT, 'demo-observations.json'), 'utf8'));
      await page.addInitScript(({ plan, observations }) => {
        localStorage.setItem('pft.display.theme', 'hero-forge');
        if (!localStorage.getItem('pft:tracking:v1')) localStorage.setItem('pft:tracking:v1', JSON.stringify({ version: 1, plan: { planId: plan.id, revision: plan.revision, formatVersion: plan.formatVersion, json: JSON.stringify(plan), importedAt: '2026-11-01T00:00:00.000Z', origin: 'import' }, activities: {}, overrides: {}, observations, quickLogs: [], imports: [], configChanges: [], completionEvents: [], daySnapshots: {} }));
      }, { plan, observations });
      await page.clock.setFixedTime(new Date('2026-11-02T09:00:00+11:00'));
      const url = new URL(process.env.PFT_LISTING_URL || 'http://localhost:8081');
      if (!['localhost','127.0.0.1'].includes(url.hostname) || url.protocol !== 'http:') throw new Error('Capture requires a loopback HTTP app server');
      await page.goto(url.href);
      await expect(page.getByTestId('day-progress')).toBeVisible();
      await expect(page.getByTestId('today-workout-loading')).toHaveCount(0);
      await page.screenshot({ path: path.join(imageDir, 'phoneScreenshots/01-daily-log.png') });
      await page.getByTestId('tab-bar').getByRole('tab', { name: 'Progress' }).click();
      await expect(page.getByTestId('progress-summary')).toBeVisible();
      await page.screenshot({ path: path.join(imageDir, 'phoneScreenshots/02-progress.png') });
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByTestId('menu-coverage').click();
      await expect(page.getByTestId('muscle-detail')).toBeVisible();
      await page.screenshot({ path: path.join(imageDir, 'phoneScreenshots/03-muscle-coverage.png') });
      if (errors.length) throw new Error('App errors during capture: ' + errors.join('; '));
      const manifestPath = path.join(ROOT, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.capture = { kind: 'actual-web-app', viewport: { width: 390, height: 780 }, deviceScaleFactor: 3, theme: 'hero-forge', fixture: 'fixtures/plans/generic-example.plan.json', observations: 'store/google-play/demo-observations.json', note: 'Demonstration data; web rendering, not evidence of native Android-only features.' };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
      await context.close();
    }
  } finally { await browser.close(); }
  validate();
  console.log('Prepared and validated listing. Review imagery and copy before uploading.');
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
