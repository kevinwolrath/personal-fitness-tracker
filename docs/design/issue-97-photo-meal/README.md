# #97 Photo meal logging: wireframes

Wireframes for Kevin to choose from before any UI is built (CLAUDE.md "UI changes"). These are plain HTML at 390 px (`mockups.html`), rendered with Playwright, **not** the running app. The photo is a placeholder and the nutrition values are illustrative.

**Entry on Today** (content layer, the Do this next card):
- **A** ([e1](e1.png)): a secondary outlined "📷 Log different meal" button under Done. The card grows by 58 px; the 200 px header budget is unchanged.
- **B** ([e2](e2.png)): a "📷 Different meal" link beside "Skip and more". 0 px.
- **C** ([e3](e3.png)): only in the meal's sheet. 0 px on Today, one extra tap. In every option the sheet also has this button, so any scheduled meal can be replaced.

**Wizard** (a full-screen modal route like `/import`):
- **Capture**, both layouts ([capture](capture.png)): camera or gallery, a denied-permission state, and a privacy note.
- **A, one page** ([wa1](wa1.png), [wa2](wa2.png)): like Configure; finished steps collapse to one line.
- **B, one step per screen** ([wb1](wb1.png), [wb2](wb2.png)): a 5-step progress strip, with Back on each step.
- **Paste error**, both layouts ([error](error.png)).
- **After Save** ([after](after.png)): the replaced row, "Eaten today" totals, and the Recorded entry.
