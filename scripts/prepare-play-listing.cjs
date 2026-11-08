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
  PACKAGE
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
    const full = path.join(dest, 'en-AU/images', file);
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
      file: 'en-AU/images/' + file,
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
      locale: 'en-AU',
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
    const graphic = await browser.newPage({
      viewport: {
        width: 1024,
        height: 500
      },
      deviceScaleFactor: 1
    });
    await graphic.goto(origin);
    await graphic.setContent(`<html><style>*{box-sizing:border-box}body{margin:0;background:#101519;color:#f1f3f4;font-family:Arial,sans-serif;width:1024px;height:500px;overflow:hidden}main{height:100%;display:flex;align-items:center;padding:56px;gap:28px;border-bottom:6px solid #ff9e42}.copy{width:390px;flex-shrink:0}.eyebrow{color:#ff9e42;font-size:15px;letter-spacing:3px;font-weight:bold}h1{font-size:56px;line-height:1.05;margin:20px 0 24px}p{color:#b5bdc4;font-size:24px;line-height:1.5;margin:0}.heroes{display:flex;align-items:center;gap:8px;height:388px}img{width:148px;height:360px;object-fit:contain}</style><main><div class="copy"><div class="eyebrow">BODY ANVIL</div><h1>Your daily<br>fitness plan.</h1><p>Log workouts.<br>Follow your progress.</p></div><div class="heroes">${['male', 'female', 'neutral'].map(c => `<img src="${origin}/assets/hero-forge/app/${c}-front.png" alt="${c} approved hero">`).join('')}</div></main></html>`);
    await graphic.evaluate(() => Promise.all([...document.images].map(i => i.decode())));
    await save(graphic, 'featureGraphic', 'feature-graphic.png', 'Body Anvil daily fitness plan, with its three established heroes', 'HTML composition using unchanged canonical hero PNGs; not an app screenshot');
    // Reuse only the approved anvil emblem from the original reference, not a new logo or hero.
    await graphic.setViewportSize({
      width: 512,
      height: 512
    });
    await graphic.setContent(`<canvas width="512" height="512"></canvas><script>const c=document.querySelector('canvas'),x=c.getContext('2d');x.fillStyle='#101519';x.fillRect(0,0,512,512);const i=new Image();i.crossOrigin='anonymous';i.onload=()=>{x.drawImage(i,12,10,158,68,40,162,432,186);document.body.dataset.ready='true'};i.src='${origin}/assets/hero-forge/references/hero-forge-character-muscle-map-reference.png';</script>`);
    await graphic.waitForFunction(() => document.body.dataset.ready === 'true');
    const icon = Buffer.from((await graphic.locator('canvas').evaluate(c => c.toDataURL('image/png'))).split(',')[1], 'base64');
    const iconPath = 'en-AU/images/icon.png';
    fs.writeFileSync(path.join(dest, iconPath), icon);
    images.push({
      type: 'icon',
      file: iconPath,
      width: 512,
      height: 512,
      sha256: sha(icon),
      alt: 'Body Anvil metallic anvil emblem on charcoal',
      source: 'Approved #75 muscle-map reference emblem crop, source rectangle 12,10,158,68; no hero redesign'
    });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8'
    }).trim();
    const manifest = {
      schemaVersion: 1,
      packageName: PACKAGE,
      defaultLocale: 'en-AU',
      locales: ['en-AU'],
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
