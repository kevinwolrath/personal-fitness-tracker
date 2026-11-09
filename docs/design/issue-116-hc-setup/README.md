# #116 Health Connect setup: wireframes

Wireframes for Kevin to choose from before any UI is built (CLAUDE.md "UI changes"). Plain HTML at 390 px (`mockups.html`), rendered with Playwright: **not** the running app. Values are illustrative (taken from the 9 Nov screenshots).

- **A** ([a](a.png)): one checklist in the existing Health Connect sheet. A tick means "import it". Each ticked row shows both checks; a failing row's **Fix** opens its steps in place.
- **B** ([choose](b1-choose.png), [check](b2-check.png)): a two-step guided setup: choose, then check. Problems appear as cards, with the working items below.
- **C** ([c](c.png)): problems first, with today's values for the working items. Choosing what to import sits behind **Choose data ›**.
- **Confirmed** ([confirmed](confirmed.png)): in every option, coming back from Health Connect re-checks and confirms what changed.

## Built: option A (chosen by Kevin)

Screenshots of the running web build at 390 px (Health Connect stand-in fixture):

- Before / after, not connected: [before](before-off.png) · [after](after-off.png)
- Before / after, connected and working: [before](before-on.png) · [after](after-on.png)
- Before / after, weight not arriving: [before](before-missing.png) · [after](after-missing.png)
- Kevin's 9 Nov case: [weight not arriving, Fix open](after-kevin-weight-missing.png) → after Fitbit may write weight and **Check again**: [confirmed](after-kevin-weight-fixed.png)
