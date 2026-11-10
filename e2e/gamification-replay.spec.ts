import { expect, test, type Page } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { journeyPlan, journeySnapshot, observation, START } from '../fixtures/gamification/journey';
import { gameFrom, type Game } from '../src/gamification/model';
import { addDays, weekdayOf } from '../src/plan/dates';
import type { StoreSnapshot } from '../src/storage/types';
import { close, expectXP, gallery, install, settings } from './gamificationHelpers';

/**
 * #121 Visual fast-forward replay of the #73 gamification journey.
 *
 * Drives the real web app (no slides): the fictional adult's first-run setup, opt-in and first quest through the UI,
 * then the deterministic `journeySnapshot` checkpoints day by day, with a few missed days and a comeback. Every frame
 * is a screenshot of the rendered app with a caption bar added *beside* it (the app is never modified), and every
 * frame asserts the shown level/XP equals the pure projection. Pauses are longer at quests, level-ups and unlocks.
 *
 * Output (REPLAY_OUT, default artifacts/gamification-replay): frames/, replay.html (plays anywhere), replay.mp4 (when
 * ffmpeg is on PATH), contact-sheet.png and milestones.md. Opt-in, phone viewport only:
 *   npm run replay:gamification
 */

const OUT = resolve(process.env.REPLAY_OUT ?? 'artifacts/gamification-replay');
const CAPTION = 76;
/** Days the fictional adult misses (no ticks, no steps), then comes back: shows XP standing still, not lost. */
const MISSED = [43, 44, 45];
/** Frame durations (ms): routine days, early days, level-ups, unlocks and other milestones. */
const FAST = 350, STEP = 700, LEVEL = 1500, PAUSE = 2600;

type Frame = { file: string; title: string; detail: string; ms: number; milestone: boolean };

test.use({ storageState: { cookies: [], origins: [] }, reducedMotion: 'reduce' });

test('gamification journey replay (#121)', async ({ page, context }, info) => {
  test.skip(process.env.REPLAY !== '1', 'opt-in: npm run replay:gamification');
  test.skip(info.project.name !== 'phone', 'recorded at the 390 px phone viewport');
  test.setTimeout(15 * 60_000);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'frames'), { recursive: true });
  const frames: Frame[] = [];
  const composer = await context.newPage();
  const { width, height } = page.viewportSize()!;
  await composer.setViewportSize({ width, height: height + CAPTION });

  /** Screenshot the real app as it is now and add the caption bar below it. */
  async function frame(title: string, detail: string, ms: number, milestone = false) {
    const png = (await page.screenshot()).toString('base64');
    const file = `frames/${String(frames.length).padStart(4, '0')}.png`;
    await composer.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body style="margin:0;background:#0b0e12;font-family:system-ui,sans-serif">
      <img src="data:image/png;base64,${png}" style="display:block;width:${width}px;height:${height}px">
      <div style="height:${CAPTION}px;box-sizing:border-box;padding:10px 16px;color:#f4f6f8;background:${milestone ? '#5a3300' : '#161b22'};border-top:3px solid ${milestone ? '#ffb52e' : '#2a313b'}">
        <div style="font-size:19px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(title)}</div>
        <div style="font-size:15px;opacity:.85;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(detail)}</div>
      </div></body></html>`);
    await composer.screenshot({ path: join(OUT, file) });
    frames.push({ file, title, detail, ms, milestone });
  }
  const showCard = () => page.getByTestId('gamification-card').scrollIntoViewIfNeeded();
  const label = (date: string) => `Week ${Math.floor(dayIndex(date) / 7) + 1} · Day ${dayIndex(date) + 1} · ${pretty(date)}`;

  // 1. First-run setup with fictional answers, through the real wizard.
  await page.clock.setFixedTime(new Date(`${START}T12:30:00+10:00`));
  await page.goto('/');
  await expect(page.getByTestId('setup-about')).toBeVisible();
  await frame('Fictional adult installs Body Anvil', `${pretty(START)} · first-run setup, fictional answers only`, PAUSE, true);
  await page.getByTestId('gender-other').click();
  await page.getByTestId('age-40_59').click();
  await page.getByTestId('weight-100_plus').click();
  await page.getByTestId('setup-primary').click();
  await page.getByRole('checkbox', { name: 'Gradual weight loss' }).click();
  await page.getByTestId('activity-some_walking').click();
  await page.getByTestId('setup-primary').click();
  await page.getByTestId('setup-primary').click();
  await expect(page.getByTestId('day-progress')).toBeVisible();

  // 2. The journey plan (its own goals: 92 kg, 96 cm waist, 12 push-ups), then opt in through Settings.
  const empty = journeySnapshot(0);
  empty.observations = [observation('weight', 100, START), observation('waist', 104, START), observation('pushups', 8, START)];
  await install(page, empty, START);
  await settings(page);
  await frame('Opt in: Settings → Gamification', 'Off by default. Nothing changes until the user turns it on.', PAUSE, true);
  await page.getByRole('switch', { name: 'Gamification', exact: true }).click();
  await close(page);
  let prev = await expectXP(page, empty, START);
  await showCard();
  await frame(label(START), `Level ${prev.level} · ${prev.xp} XP · quests ready`, STEP);

  // 3. The first quest, ticked in the real Daily Log: live celebrations.
  await page.getByTestId('activity-meal').getByRole('checkbox').click();
  await expect(page.getByTestId('game-celebration').first()).toContainText('Achievement unlocked');
  await page.getByTestId('game-celebration').first().scrollIntoViewIfNeeded();
  await frame('Achievement unlocked: first quest', `${label(START)} · Balanced meal ticked · +20 XP`, PAUSE, true);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByTestId('activity-walk').getByRole('checkbox').click();
  await expect(page.getByTestId('game-celebration').first()).toContainText('Quest complete');
  await page.getByTestId('game-celebration').first().scrollIntoViewIfNeeded();
  await frame('Quest complete', `${label(START)} · Comfortable walk ticked`, PAUSE, true);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // 4. Fast-forward through the fixture: daily for two weeks, then every other day, then twice a week.
  const days = [...range(1, 14), ...range(14, 60, 2), ...MISSED, 46, ...range(48, 120, 3), 119]
    .filter((d, i, a) => a.indexOf(d) === i)
    .sort((a, b) => a - b);
  prev = gameFrom(withMisses(journeySnapshot(1), 0), journeyPlan, START);
  for (const d of days) {
    const date = addDays(START, d);
    const snap = withMisses(journeySnapshot(d + 1), d);
    await install(page, snap, date);
    const g = await expectXP(page, snap, date); // the frame shows exactly what the records earn
    const events = changes(prev, g);
    const missed = MISSED.includes(d);
    await showCard();
    const delta = g.xp - prev.xp;
    const detail = `Level ${g.level} · ${g.xp} XP${delta ? ` · +${delta} XP` : ''}${missed ? ' · missed day: no XP lost' : ''}`;
    if (events.length) {
      // A level-up alone is common (every 200 XP): a short hold. Unlocks and weekly quests get the full pause.
      const levelOnly = events.length === 1 && events[0].startsWith('Level up');
      await frame(events[0], `${label(date)} · ${detail}`, levelOnly ? LEVEL : PAUSE, true);
      const unlocked = g.achievements.filter((a) => a.unlocked && !prev.achievements.find((p) => p.id === a.id)?.unlocked);
      if (unlocked.length) {
        await gallery(page);
        await page.getByTestId(`achievement-${unlocked[0].id}`).scrollIntoViewIfNeeded();
        await frame(`Gallery: ${unlocked.map((a) => a.title).join(', ')}`, `${label(date)} · ${g.achievements.filter((a) => a.unlocked).length} of ${g.achievements.length} unlocked`, PAUSE, true);
        await close(page);
      }
    } else {
      await frame(missed ? 'Missed day' : d === 46 ? 'Back on track' : label(date), missed || d === 46 ? `${label(date)} · ${detail}` : detail, missed || d === 46 ? STEP * 2 : d < 14 ? STEP : FAST, missed || d === 46);
    }
    prev = g;
  }

  // 5. Goal reached: the last weigh-in entered through the real Weight tile.
  const last = addDays(START, 120);
  const final = journeySnapshot(121);
  final.observations = final.observations.map((o) => (o.date === last && o.metric === 'weight' ? { ...o, value: 92.1 } : o));
  await install(page, final, last);
  await expectXP(page, final, last);
  await page.getByTestId('measurement-weight').click();
  await page.getByTestId('measure-input').fill('92');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('game-celebration').first()).toContainText('Milestone reached');
  await page.getByTestId('game-celebration').first().scrollIntoViewIfNeeded();
  await frame('Goal reached: 92 kg', `${label(last)} · weighed in through the Weight tile`, PAUSE + 600, true);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await gallery(page);
  await page.getByTestId(`achievement-${journeyPlan.id}:weight-goal:goal:92`).scrollIntoViewIfNeeded();
  await frame('Final gallery', `${label(last)} · four months of quests and milestones`, PAUSE + 600, true);
  await close(page);
  await page.goto('/progress');
  await expect(page.getByTestId('progress-summary')).toBeVisible();
  await frame('Progress after four months', `${pretty(START)} → ${pretty(last)} · fictional data only`, PAUSE + 600, true);
  expect(frames.filter((f) => f.milestone).length).toBeGreaterThan(8);

  await composer.close();
  writeOutputs(frames, width, height + CAPTION);
  // The contact sheet: key moments only (level-ups alone are listed in milestones.md).
  await contactSheet(page, frames.filter((f) => f.milestone && !f.title.startsWith('Level up')));
});

/** Days in MISSED have no ticks and no steps (a real gap in the records, not a reward change). */
function withMisses(s: StoreSnapshot, upTo: number): StoreSnapshot {
  const gone = new Set(MISSED.filter((d) => d <= upTo).map((d) => addDays(START, d)));
  return { ...s, activityLogs: s.activityLogs.filter((l) => !gone.has(l.date)), observations: s.observations.filter((o) => !(gone.has(o.date) && o.metric === 'steps')) };
}

/** What happened between two checkpoints, most notable first. */
function changes(a: Game, b: Game): string[] {
  const out: string[] = [];
  if (b.level > a.level) out.push(`Level up: Level ${b.level}`);
  for (const x of b.achievements) if (x.unlocked && !a.achievements.find((y) => y.id === x.id)?.unlocked) out.push(`${x.milestone ? 'Milestone' : 'Achievement'}: ${x.title}`);
  if (b.weekly.done && (!a.weekly.done || a.weekly.id !== b.weekly.id)) out.push(`Weekly quest complete: ${b.weekly.label}`);
  return out;
}

function writeOutputs(frames: Frame[], w: number, h: number) {
  // Player that works anywhere a browser does (CI artifact, no codecs needed).
  writeFileSync(join(OUT, 'replay.html'), `<!doctype html><meta charset="utf-8"><title>Body Anvil gamification replay</title>
<body style="margin:0;background:#000;display:grid;place-items:center;min-height:100vh;font-family:system-ui;color:#ccc">
<img id="f" style="max-height:96vh;width:auto;aspect-ratio:${w}/${h}"><div><button id="p">Pause</button> <button id="r">Restart</button> <span id="n"></span></div>
<script>const F=${JSON.stringify(frames.map((f) => [f.file, f.ms]))};let i=0,t,run=true;const f=document.getElementById('f'),n=document.getElementById('n');
function show(){f.src=F[i][0];n.textContent=(i+1)+' / '+F.length;clearTimeout(t);if(run&&i<F.length-1)t=setTimeout(()=>{i++;show()},F[i][1]);}
document.getElementById('p').onclick=e=>{run=!run;e.target.textContent=run?'Pause':'Play';show()};document.getElementById('r').onclick=()=>{i=0;run=true;show()};show();</script>`);
  const total = frames.reduce((n, f) => n + f.ms, 0);
  let at = 0;
  writeFileSync(join(OUT, 'milestones.md'), `# Gamification replay: milestones\n\nFictional adult, synthetic dates ${START} → ${addDays(START, 120)}. ${frames.length} frames, ${(total / 1000).toFixed(0)} s.\n\n| Time | Frame | What |\n|---|---|---|\n${frames
    .map((f) => {
      const row = f.milestone ? `| ${mmss(at)} | ${f.file} | **${f.title}**: ${f.detail} |` : '';
      at += f.ms;
      return row;
    })
    .filter(Boolean)
    .join('\n')}\n`);
  // MP4 when ffmpeg is available (concat demuxer: each frame held for its own duration).
  const list = frames.map((f) => `file '${f.file}'\nduration ${(f.ms / 1000).toFixed(3)}`).join('\n') + `\nfile '${frames[frames.length - 1].file}'\n`;
  writeFileSync(join(OUT, 'frames.txt'), list);
  const ff = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.txt', '-vf', 'scale=780:-2,fps=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '26', '-movflags', '+faststart', 'replay.mp4'], { cwd: OUT });
  if (ff.error || ff.status !== 0) writeFileSync(join(OUT, 'NO-MP4.txt'), `ffmpeg unavailable or failed; open replay.html instead.\n${ff.error ?? ff.stderr}`);
}

async function contactSheet(page: Page, frames: Frame[]) {
  const cols = 5, w = 200;
  await page.setViewportSize({ width: cols * (w + 8) + 8, height: 800 });
  await page.goto('about:blank');
  await page.setContent(`<body style="margin:0;padding:8px;background:#0b0e12;color:#eee;font:12px system-ui;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:8px">
    ${frames.map((f) => `<figure style="margin:0"><img src="file://${join(OUT, f.file)}" style="width:${w}px"><figcaption>${esc(f.title)}</figcaption></figure>`).join('')}</body>`);
  // file:// images from about:blank: fall back to inlining if the browser blocks them.
  const broken = await page.evaluate(() => [...document.images].some((i) => !i.complete || i.naturalWidth === 0));
  if (broken) {
    const { readFileSync } = await import('node:fs');
    await page.setContent(`<body style="margin:0;padding:8px;background:#0b0e12;color:#eee;font:12px system-ui;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:8px">
      ${frames.map((f) => `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(join(OUT, f.file)).toString('base64')}" style="width:${w}px"><figcaption>${esc(f.title)}</figcaption></figure>`).join('')}</body>`);
  }
  await page.screenshot({ path: join(OUT, 'contact-sheet.png'), fullPage: true, scale: 'css' });
}

const range = (from: number, to: number, step = 1) => Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => from + i * step);
const dayIndex = (date: string) => Math.round((Date.parse(date) - Date.parse(START)) / 86_400_000);
const pretty = (date: string) => `${weekdayOf(date).replace(/^./, (c) => c.toUpperCase())} ${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
const mmss = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
