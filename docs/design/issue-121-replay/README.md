# Issue #121 · Gamification journey replay

One video of a **fictional** Body Anvil user going through four months (1 July – 29 October 2026, synthetic dates) in the real web app. Days and weeks advance, XP builds, levels rise, quests complete and achievements unlock. There are three missed days and a comeback, and the weight goal is reached at the end.

- **Watch:** [replay.mp4](replay.mp4) (about 2 min, 780 px wide). The caption bar under the app shows week, day, date, level and XP.
- **At a glance:** [contact-sheet.png](contact-sheet.png) (key moments).
- **Index:** [milestones.md](milestones.md) (every milestone with its time in the video).

## What it is (and isn't)

- Every frame is a screenshot of the rendered app. The caption bar is added *beside* the screenshot, so the app is never changed for the replay, and there are no slides or mock-ups.
- The first steps are real UI interactions: first-run setup with fictional answers, opting in under Settings, ticking the first quests (live celebrations), and the goal weigh-in through the Weight tile.
- The months in between replay the existing deterministic fixture `fixtures/gamification/journey.ts` (`journeySnapshot`), installed into isolated Playwright storage day by day, with the same helpers as `e2e/gamification.spec.ts` (`e2e/gamificationHelpers.ts`). Each frame asserts that the shown "Level N · X XP" equals the pure projection `gameFrom` of those records.
- Missed days (days 44–46) remove that day's ticks and steps from the fixture. XP stands still and isn't lost.
- Pacing: 0.35 s for routine days (0.7 s in the first two weeks), 1.5 s for a level-up, and 2.6 s for quests, unlocks, weekly quests, the gallery and the goal.
- No real health data, no network, no AI. Fictional adult only.

## Reproduce

```bash
npm run replay:gamification          # REPLAY=1, phone viewport (390 px); about 2 minutes
```

The output goes to `artifacts/gamification-replay/` (git-ignored; set `REPLAY_OUT` to change it):

- `replay.mp4` (needs `ffmpeg` on PATH)
- `replay.html` (a player that works in any browser, even without ffmpeg)
- `contact-sheet.png`
- `milestones.md`
- `frames/`

Without a local desktop: **Actions → Gamification replay (.45) → Run workflow** runs it on the self-hosted runner and keeps `gamification-replay` as a 30-day artifact. It's manual only. If ffmpeg isn't on that runner, use `replay.html` from the artifact.

The normal `npm run test:e2e` skips the replay (opt-in), and the #73 journey assertions in `e2e/gamification.spec.ts` are unchanged.

## Limitations

- This is the web build at a phone viewport. Native Android rendering and Health Connect aren't part of the replay.
- Between fixture checkpoints the app reloads. The video shows each settled state, not the reload.
- Celebrations appear only for live changes (contract 16), so in the fast-forward an unlock is shown in the achievement gallery, not as a celebration banner.
- Observed, not changed: at 390 px the three measurement tiles truncate their values (`96....`). That's existing behaviour.
