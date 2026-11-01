# Personal Fitness Tracker

A deliberately simple, local-first personal fitness and weight-loss tracker built with Expo, React Native and TypeScript.

## V1 goals

- Today-first interface
- Weekday-aware daily plan
- Weight entry and target display
- Daily energy/protein targets
- Fixed lunch/snack reminders
- Family dinner treated as the flexible meal
- Large tap targets for activity completion
- Nightly VR boxing: 3 × 3 minute rounds
- Hunger-event logging
- Local-only data; no auth/backend required for V1

## Run locally

```bash
npm install
npm start
```

Then open in Expo Go or run:

```bash
npm run android
```

## Next steps

- Persist weight, completion state and hunger events in SQLite
- Add weekly weight trend
- Add weekly waist measurement
- Add editable fixed lunch/snack definitions
- Add simple history screen
- Add Android build workflow
