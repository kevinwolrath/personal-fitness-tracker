// Uses the actual production export. Never draws or fabricates screenshot UI.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  execFileSync
} = require('node:child_process');
const {
  chromium
} = require('@playwright/test');
const {
  sha,
  pngInfo,
  PACKAGE,
  LOCALE
} = require('./play-listing');
const root = path.resolve(__dirname, '..');
const dest = path.join(root, 'store/google-play');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf'
};
async function prepare() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const asset = url.pathname.startsWith('/assets/hero-forge/');
    const base = asset ? root : path.join(root, 'dist');
    let file = path.resolve(base, '.' + decodeURIComponent(url.pathname));
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(base, 'index.html');
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] || 'application/octet-stream'
    });
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({
    ignoreDefaultArgs: ['--hide-scrollbars']
  }).catch(async error => {
    await new Promise(resolve => server.close(resolve));
    throw error;
  });
  const images = [];
  const save = async (page, type, file, alt, source) => {
    const full = path.join(dest, LOCALE, 'images', file);
    fs.mkdirSync(path.dirname(full), {
      recursive: true
    });
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    await page.screenshot({
      path: full,
      animations: 'disabled'
    });
    const data = fs.readFileSync(full);
    const info = pngInfo(data);
    images.push({
      type,
      file: LOCALE + '/images/' + file,
      width: info.width,
      height: info.height,
      sha256: sha(data),
      alt,
      source
    });
  };
  try {
    const seedJson = fs.readFileSync(path.join(root, 'plans/seed.plan.json'), 'utf8');
    const seed = JSON.parse(seedJson);
    const tracking = {
      version: 1,
      plan: {
        planId: seed.id,
        revision: seed.revision,
        formatVersion: seed.formatVersion,
        json: seedJson,
        importedAt: '2026-11-01T00:00:00.000Z',
        origin: 'seed'
      },
      activities: {},
      overrides: {},
      observations: [],
      quickLogs: [],
      imports: [],
      configChanges: [],
      completionEvents: [],
      daySnapshots: {}
    };
    const context = await browser.newContext({
      viewport: {
        width: 390,
        height: 780
      },
      deviceScaleFactor: 3,
      locale: LOCALE,
      timezoneId: 'Australia/Sydney',
      storageState: {
        cookies: [],
        origins: [{
          origin,
          localStorage: [{
            name: 'pft:tracking:v1',
            value: JSON.stringify(tracking)
          }, {
            name: 'pft.display.theme',
            value: 'hero-forge'
          }]
        }]
      }
    });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-02T09:00:00+11:00'));
    await page.goto(origin);
    await page.getByTestId('today-workout-show-all').waitFor({
      timeout: 60000
    });
    await save(page, 'phoneScreenshots', 'phone/01-today.png', 'Daily plan and workout checklist with no logged history', 'Production React Native Web app, bundled seed plan, empty records');
    await page.getByTestId('today-workout-show-all').click();
    await page.getByTestId('today-workout-sheet').waitFor();
    await save(page, 'phoneScreenshots', 'phone/02-workout.png', 'Planned exercises and existing muscle coverage artwork', 'Production workout sheet; no fabricated completions');
    await page.getByTestId('today-workout-sheet').getByRole('button', {
      name: 'Goblet squat. Show how',
      exact: true
    }).click();
    await page.getByTestId('exercise-guide').waitFor();
    await page.getByTestId('guide-image-1').evaluate(async el => {
      const i = el.querySelector('img') || el;
      if (i.decode) await i.decode();
    });
    await save(page, 'phoneScreenshots', 'phone/03-guide.png', 'Kettlebell squat guide with approved hero exercise artwork', 'Production read-only exercise guide; existing #86 image');
    await page.goto(origin + '/progress');
    await page.getByTestId('chart-weight').waitFor();
    await save(page, 'phoneScreenshots', 'phone/04-progress.png', 'Progress screen showing honest empty measurement states', 'Production charts with empty history');
    await context.close();
    const branding = require('./branding.cjs').approvedBranding();
    for (const [type, asset, file, alt, master] of [
      ['featureGraphic', 'feature-graphic.png', 'feature-graphic.png', 'Approved Body Anvil three-hero promotional artwork', 'body-anvil-approved-heroes.png'],
      ['icon', 'store-icon-512.png', 'icon.png', 'Approved female hero with purple outfit and anvil chest emblem', 'body-anvil-approved-female-launcher-original.png'],
    ]) {
      const bytes = branding.read(asset);
      const target = LOCALE + '/images/' + file;
      fs.writeFileSync(path.join(dest, target), bytes);
      const info = pngInfo(bytes);
      images.push({ type, file: target, width: info.width, height: info.height, sha256: sha(bytes), alt,
        source: `Deterministic #106 export from assets/branding/${master}; approved master SHA-256 ${branding.manifest.sources[master]}; no regenerated artwork` });
    }
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim();
    const manifest = {
      schemaVersion: 1,
      packageName: PACKAGE,
      defaultLocale: LOCALE,
      locales: [LOCALE],
      capture: {
        engine: 'playwright-production-web',
        sourceCommit: commit,
        viewport: {
          width: 390,
          height: 780,
          deviceScaleFactor: 3
        },
        plan: 'plans/seed.plan.json',
        fixtureTime: '2026-11-02T09:00:00+11:00',
        tracking: 'empty',
        note: 'Actual production web rendering. Confirm native Android parity in Play Console review; no device frame, overlays or simulated tracking.'
      },
      images
    };
    fs.writeFileSync(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log('Prepared listing assets and provenance; run npm run store:validate.');
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
}
prepare().catch(e => {
  console.error(e.message);
  process.exitCode = 1;
});
