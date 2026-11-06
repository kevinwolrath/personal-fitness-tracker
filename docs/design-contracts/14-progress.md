# 14 · Progress (#52)

The **Progress** tab, beside Today in the bottom tab bar (02), shows whether the plan is working. It is read-only: values are entered and corrected on Today (or imported), never here.

Delivered in two parts: measurements and weight trends (PR #64), then activity, energy and protein (part 2).

## Layout (option A)

- **Screen header:**
  - the title **Progress**;
  - **Edit charts**;
  - the range: 7 days, 30 days (the default), 90 days or All.
- **Content:**
  - a **This week vs last** card: the change in the weekly average weight and in the latest waist measurement, and workouts done this week (with last week's count);
  - one card per chart, in the user's order;
  - a footnote: dots are values as recorded, lines are calculated, and nothing is filled in.
- **Edit charts** is a sheet listing every chart with a show/hide switch and **Move up / Move down** buttons. There's no drag, so it works with screen readers.
  - The order and visibility are a **device preference** (`preferences.progressCharts`), never plan data. Unknown ids are dropped and new charts are appended.
  - Hidden charts keep their data.

## Charts (first PR)

| Chart | Shows | Rules |
|---|---|---|
| Weight | Weigh-ins (dots) and a 7-day average (line), in the plan's mass unit | One value per day: a value the user entered beats an imported one (06). The average uses only real weigh-ins in the window. |
| Waist | Measurements (dots only) | Usually weekly; never joined into a line. Empty state says how to start (or how to add waist to the plan). |
| BMI | kg/m², per weigh-in, **Calculated** | Only from real weigh-ins and `profile.heightCm`. Never from a weight or age band. No height: an empty state pointing to Edit setup answers (13). Notes that BMI doesn't tell fat from muscle. |
| Weight vs waist | % change from the start of the range: weight (7-day average, line) and waist (dots) | Needs two of each. When the waist falls with steady weight, the note says this is *consistent with* body recomposition, not proof of muscle gain. |
| Weekly rate | Trend over the last 4 weeks (kg/week) and week-on-week change of weekly averages | Slowdown compares the last 4 weeks with the 4 before: "slower / about the same / faster / direction changed", stated as facts. Never claims metabolic adaptation. |
| Goal | The plan's mass goal (dashed line) and the 7-day average | Projection is a date **range** from the trend ± its uncertainty, "a projection, not a promise". No projection when moving away or with too little data. |
| Body fat | Scale readings (dots), **Estimate** | Fat and lean mass estimated on days with both a weight and a body-fat reading. Notes that consumer scales estimate. |

## Charts (part 2: activity, energy and protein)

| Chart | Shows | Rules |
|---|---|---|
| Workouts | Per week: sessions done (bars) and scheduled (dots) | A workout is a required plan item with a session, or a strength or conditioning purpose; walks and errands count in active minutes and steps instead. Scheduled is computed from the **current plan** with the day's day-type override; skipped isn't done. Sessions recorded by other apps are counted separately in the subtitle. |
| Active minutes | Minutes per week (bars) | A wearable's active minutes for a day, or else that day's recorded workout durations, never both. |
| Steps | Days (dots) and a 7-day average (line) | Distance over the range in the subtitle. |
| Energy eaten vs burned | Eaten (logged or imported) and burned (a wearable), **Estimate** | In the phone's energy unit (11). Ticked planned meals never count as eaten. Says both are estimates. |
| Energy balance | Weekly average of eaten minus burned (bars), **Estimate** | Only weeks with both. Says the weight trend is the better guide. |
| Protein | Logged or imported protein (dots) against the plan's protein target minimum | Ticked planned meals never count. |

- **Every chart:**
  - units and a legend;
  - an accessible one-sentence summary;
  - an empty state that says what's needed.
- **Tap to inspect** shows the nearest value's date, value and source: entered by you, imported from an app, from a screenshot, or calculated.
- **No interpolation:** gaps stay gaps, and measured values are never drawn as continuous lines.
- **Calculations** are pure functions in `src/progress/series.ts` and `src/progress/report.ts`.
- **Data** comes from `store.observationsFor(metrics)`, which returns observed values only, never inferred ones, and `store.planHistory(planId)` (activity logs and day-type overrides) for workouts.
