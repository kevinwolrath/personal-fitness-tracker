# #90 Today's workout counts and conditioning: wireframes

Wireframes for Kevin to choose from before any layout changes (CLAUDE.md "UI changes"; the ticket's design gate). They are plain HTML at 390 px (`mockups.html`), rendered with Playwright, **not** the running app. Counts use the seed plan's Monday (5 planned exercises; 12 eligible in the catalogue).

**Today's workout**
- **A** ([card](workout-a-card.png), [sheet](workout-a-sheet.png)): counts and "Show all" cover the prescribed exercises only. The catalogue sits behind one "Extras" row in the sheet.
- **B** ([sheet](workout-b-sheet.png)): a switch between Today's plan and All exercises.

**High-intensity conditioning**
- **A** ([not started](conditioning-a.png), [partial](conditioning-a-partial.png), [done](conditioning-a-done.png)): three stacked choices, each with its dose. The method in progress is highlighted, and the row collapses once done.
- **B** ([chips](conditioning-b.png)): the current chips with a dose line, and the method in progress highlighted.
