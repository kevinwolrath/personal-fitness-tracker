# Google Play listing: Body Anvil (draft, #59)

**Status: draft for review. Do not publish.** Play Console is edited by hand: the release workflow only uploads the AAB. This file is the reviewable source for the listing text. Before any Play release of the renamed build, all of these must be done:

- [ ] This copy approved (#59).
- [ ] Artwork approved and produced (#60): icon, feature graphic, screenshots.
- [ ] Name check completed: IP Australia trademark search, and an exact-title search on Google Play (the preliminary web check on #59 found similar "Anvil" fitness apps).

The app's identity in Play doesn't change: package `com.questspire.personalfitnesstracker`, the same upload key and the same app entry. Only the listing text and graphics change, so existing installs update in place.

## Store fields

| Field | Limit | Draft |
|---|---|---|
| App name | 30 | `Body Anvil` |
| Short description | 80 | `Plan, track and shape your health: meals, activity, weight and progress.` |
| Category | | Health & Fitness |
| Tags (pick up to 5 in Play Console) | | Fitness tracking, Diet & nutrition, Weight loss, Workout tracker, Health records |
| Contact email | | *(Kevin to supply)* |
| Privacy policy URL | | *(required, see "Before release" below)* |

The tagline **Hammer Out Your Destiny** opens the full description and appears on the feature graphic and splash (#60). It isn't part of the app name or the in-app header.

## Full description (≤ 4,000 characters)

> **Hammer Out Your Destiny.**
>
> Body Anvil is a personal health app for shaping your days deliberately: your plan, your meals, your activity and your progress, in one calm daily log.
>
> **Know what to do now**
> Today shows the one thing that makes sense right now: the school run when it's due, lunch near noon, the workout when your plan has time for it. When nothing needs doing, it stays out of your way.
>
> **Your plan, your way**
> Meals with amounts and preparation, strength sessions with a full or short version, walks and conditioning with alternatives. Tick things off as you go, and correct any past day.
>
> **Workouts, exercise by exercise**
> Follow a session as a checklist, with illustrated guides for each exercise and substitutions for movements you need to avoid.
>
> **Progress you can trust**
> Weight trend, measurements, workouts, active minutes, steps, energy and protein, week on week. Every value says whether it was measured, estimated or calculated.
>
> **Brings in what your phone already records**
> Read-only Health Connect import of steps, active energy, workouts, weight, body fat and sleep. Nothing is written back.
>
> **Change your plan by talking it through**
> Plan with ChatGPT or Claude: the app gives you instructions to paste in, checks every proposed change and shows you a preview before applying it.
>
> **Your data stays yours**
> Everything is stored on your device. No account, no ads. Export your full history as JSON at any time.
>
> Body Anvil is a planning and tracking tool, not medical advice. Exercise and meal plans are for adults; speak to a health professional before making significant changes.

*(Check the length in Play Console after final edits. The draft is about 1,600 characters.)*

## Screenshots (captured once, after #60)

Phone, portrait, 390 × 844 viewport at 2× (Play needs 2–8 phone screenshots). Captured from the e2e fixtures with the #60 framing, so they're made once:

1. **Do this next:** a due meal with what to prepare. Caption: "Know what to do now."
2. **The day:** Daily Log grouped by part of day. Caption: "Your whole day, one calm list."
3. **Workout:** the exercise checklist expanded. Caption: "Train exercise by exercise."
4. **Exercise guide:** illustrated steps. Caption: "See how, every time."
5. **Progress:** this week vs last, weight trend. Caption: "Progress you can trust."
6. **Health Connect:** the import sheet. Caption: "Bring in what your phone records."

The feature graphic (1024 × 500) and icon (512 × 512) come from #60.

## iOS (plan only)

There is no iOS release today. If one is added: same bundle ID (`com.questspire.personalfitnesstracker`), App Store name `Body Anvil`, subtitle `Hammer Out Your Destiny` (30 limit: 23), the same description adapted to Apple Health in place of Health Connect, and screenshots at the iPhone 6.9" size.

## Before release: listing compliance to review

- **Health apps declaration and data safety:** unchanged by the rename (contract 12, "Google Play").
- **Screenshot import:** sends the screenshots the user picks to Anthropic's API, with the user's own key, only when they tap Read (contract 06). The data-safety form and privacy policy must cover this. It isn't "nothing leaves the device".
- **Privacy policy URL:** required for the Health Connect permissions. It must name Body Anvil, the health data read, on-device storage, and the screenshot exception above.
