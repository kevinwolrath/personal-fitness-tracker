# 11 · Settings and energy display

Device preferences, and how energy is shown (#39). A preference is a choice about this phone. It is never plan data: a plan import or Configure with AI can't read or change it, and it isn't in the plan JSON or the export.

## Settings

- **Where:** **Settings** in the app menu (app shell layer, contract 02). Its detail line states the current energy display: "Energy in kJ", "Energy in kcal" or "Energy in kJ and kcal". It opens the Settings sheet (`ModalHeader` "Settings", **Close**).
- **What:** one group for now, **Energy units**: a radio group with **Kilojoules (kJ)**, **Calories (kcal)** and **Both**. Each choice shows the same example amount in that display ("1,780 kJ", "425 kcal", "1,780 kJ / 425 kcal"). Under the group: *Food "calories" are kilocalories (kcal). 1 kcal = 4.184 kJ. This only changes how energy is shown on this phone: your plan and your records stay as they are.*
- **Behaviour:** a choice applies immediately, everywhere, with no restart. It's remembered across restarts (`preferences`, device storage: key `pft.display.energy`).
- **Default:** until the user picks, the display is the plan's own `units.energy`, so nothing changes for anyone who hasn't chosen. The bundled plan is in kJ, so the default is kJ.
- **Daily Log:** gains no controls. Only the energy text changes.

## Energy display

- **Stored values never change.** Observations are stored in kJ (contract 06). Plan amounts (`nutrition.targets`, a meal's `nutrition`) stay in the plan's `units.energy` (contract 03). Switching the display writes nothing.
- **Conversion:** 1 kcal = 4.184 kJ.
- **Rounding:** kJ to the nearest 10, kcal to the nearest whole number. Each shown number is converted from the stored value and rounded **once**. Totals and amounts left are computed on stored values and then formatted, so nothing drifts and a converted number is never converted again.
- **Formats:**

  | Display | One amount | Target bound |
  |---|---|---|
  | kJ | `1,780 kJ` | `Energy ≤ 7,530 kJ` |
  | kcal | `425 kcal` | `Energy ≤ 1,800 kcal` |
  | Both | `1,780 kJ / 425 kcal` (kJ first, one line) | `Energy ≤ 7,530 kJ / 1,800 kcal` (the sign once; a range per unit: `6,300–7,100 kJ / 1,506–1,697 kcal`) |

- **Everywhere energy appears:**
  - the daily targets line;
  - a meal's energy, on the "Do this next" card and in the item sheet;
  - the flexible-meal budget ("≈ 2,350 kJ / 561 kcal left");
  - recorded observations (active, total and eaten energy, from any source, including Health Connect imports);
  - the Configure with AI preview and summary (contract 07).

  Grams are never affected.
- **Accessibility:** screen readers hear unit words: "1,780 kilojoules, 425 kilocalories".
- **Corrections:** an energy observation is corrected in the first unit shown (kcal for kcal, kJ for kJ and both) and stored back in kJ. Saving unchanged text doesn't rewrite the stored value, which was rounded only for display.
- **Fit:** in Both, the targets line and a meal's energy line fit on one line at 390 px with the bundled plan. The responsive sweep (contract 05) checks Both at every width.

Code: `src/energy.ts` (pure), `src/format.ts`, `src/plan/meals.ts`, `src/observations/format.ts`, `src/config/diff.ts`; UI in `src/features/settings/SettingsSheet.tsx`; preference in `src/platform/preferences.ts` and `AppProvider`.
