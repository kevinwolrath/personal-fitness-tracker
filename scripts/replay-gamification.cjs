#!/usr/bin/env node
/**
 * #121 Build the gamification journey replay (e2e/gamification-replay.spec.ts) at the 390 px phone viewport.
 * Cross-platform (Windows runner and Linux): sets REPLAY=1 and runs Playwright. Output: artifacts/gamification-replay/
 * (override with REPLAY_OUT). MP4 needs ffmpeg on PATH; replay.html always works.
 */
const { spawnSync } = require('node:child_process');
const r = spawnSync('npx', ['playwright', 'test', 'e2e/gamification-replay.spec.ts', '--project=phone', '--trace', 'off', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, REPLAY: '1' },
});
process.exit(r.status ?? 1);
