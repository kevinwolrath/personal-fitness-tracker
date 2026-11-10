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
| Workouts | Per week: sessions done (bars) and scheduled (dots) | A workout is a required plan item with a session, or a strength or conditioning purpose; walks and errands count in active minutes and steps instead. Scheduled is computed from **the plan in effect on each day** (#67): every configuration change stores the plan it replaced, and that plan applies to the days before the change; days after the last change use the current plan. The day's day-type override applies; skipped isn't done. Sessions recorded by other apps are counted separately in the subtitle, distinct sessions (several non-duplicate sessions on one day count separately); overlapping Health Connect source copies are projected once (#104). |
| Active minutes | Minutes per week (bars) | A wearable's active minutes for a day, or else that day's recorded workout durations, never both. Health Connect intervals are unioned, not summed; missing timings give a labelled lower bound. Available walking distance is shown in the chart note in m/km, using only recorded non-overlapping distances (#104). |
| Steps | Days (dots) and a 7-day average (line) | Distance over the range in the subtitle. |
| Energy eaten vs burned | Eaten (logged or imported) and burned, **Estimate** | **Burned** comes from one of two sources, never both on the same day (`src/progress/expenditure.ts`). A day's **total energy** (entered, from a screenshot or imported) is used when there is one. Otherwise burned is **estimated resting energy + active energy** (Health Connect's ActiveCaloriesBurned). Resting energy uses Mifflin–St Jeor from the user's own height, age (an exact age or the middle of the age band) and sex (the midpoint when unknown), with the latest weigh-in, else the setup weight. It is never estimated for under-18s. Without height, age or weight, active energy alone is **never** shown as burned: the chart says what to add. The two sources are separate, labelled series, so measured totals and estimates are never mixed up. In the phone's energy unit (11). Ticked planned meals never count as eaten. A day's eaten is its day total (entered or imported) if it has one, otherwise the sum of its logged meals (#97, contract 15): never both. Tap to inspect says "from logged meals". Says both are estimates. |
| Energy balance | Weekly average of daily eaten minus burned (bars), **Estimate** | Only **finished days** with both values count (#67; today is still in progress and never counts). A day whose logged meals don't all state their energy is an under-count and is left out: a day's intake is never compared with another day's expenditure. Weeks without such a day have no bar. Says the weight trend is the better guide. |
| Protein | Logged or imported protein (dots) against the plan's protein target minimum | Ticked planned meals never count. Logged meals count on days without a protein day total (#97), never added to one. |

- **Every chart:**
  - units and a legend;
  - an accessible one-sentence summary;
  - an empty state that says what's needed.
- **Tap to inspect** shows the nearest value's date, value and source: entered by you, imported from an app, from a screenshot, or calculated.
- **No interpolation:** gaps stay gaps, and measured values are never drawn as continuous lines.
- **Calculations** are pure functions in `src/progress/series.ts` and `src/progress/report.ts`.
- **Data** comes from `store.observationsFor(metrics)`, which returns observed values only, never inferred ones, `store.planHistory(planId)` (activity logs and day-type overrides) and `store.configHistory()` (earlier plan versions, `planVersionsFrom`) for workouts.

## Trend and forecast (#57, layout A)

- **Trend card** at the top of Progress: the weight trend's plain status (`trendInsight`, `src/progress/forecast.ts`): **Flat for N weeks**, **Slower than before**, **Trending up**, **Steady**, or **Not enough weigh-ins yet** with what's missing. A plateau needs 3+ weeks and 6+ weigh-ins with a flat trend (under 0.1 kg or 0.2 lb a week); a few flat days never count. Its explanation never says the body refuses to lose fat.
- **What you can try**: optional steps (intake logging, activity, protein and strength training, sleep, and a deliberate plan change with Configure with AI). Nothing changes a target, intake or training automatically.
- **Forecast** on the Goal chart (**Estimate**): a dashed line at the recent rate (up to 6 weeks) from the latest 7-day average, with a range that widens with the rate's uncertainty, up to 12 weeks. The first two weeks of weigh-ins are left out once later data exists, so early water weight is never projected. No forecast without 6 weigh-ins over 3 weeks or with no weigh-in in the last 2 weeks.
- **Alert (option b)**: a dot on the Progress tab, and one phone notification if notifications are already allowed (it never asks), for a new plateau or slowdown. Once per finding, at most once a week, only with a weigh-in in the last 3 days. Opening Progress clears the dot. **Settings → Weight trend alerts** turns it off (a device preference). There is no "behind target" alert until the plan has a target pace or date.
