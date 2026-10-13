# Forgiving habit progress

Reading this as: an existing Godspeed Mission Control habit tracker for its owner, in Operate mode, seen on a narrow phone or desktop during a brief daily check. Vibe: calm, readable, encouraging.

Brief: Michael asked to implement the approved forgiving-streak concept and "make it very easy to read", including weekday labels. The next action is a meaningful habit completion, labelled "Mark today done". Remember that every completed day stays. Facts come exclusively from the coach's records and server progress calculation; no promotional claims or invented personal data are added.

## Plan v1

Flat because this is a tool. Extend existing fonts, CSS token roles, buttons and form controls. Put lifetime completed days first and the current run second. Show seven real calendar dates in a weekly strip with weekday, date, icon and Today label. Show larger aspirations through a single milestone bar. Keep detailed history and settings folded. No animation beyond existing button feedback.

Desktop: title + tiny action / completion button / lifetime total beside current streak / milestone / seven days + legend / recording form / folded pauses / folded history.

390px and 320px: same reading order, totals wrap naturally, seven narrow date columns remain one row; legend uses two columns on narrow screens; forms use one column. No horizontal history table.

Visual material is the real seven-day record. Canvas, surface, ink, soft ink, accent and accent ink are inherited from the app's background, card, foreground, muted-foreground, primary and primary-foreground tokens. Type uses the app's existing self-hosted display and body families. The strong move is the labelled week, whose actual weekday, date, state icon and accessible spoken status make it understandable without colour.

## Review

The existing app's fonts and cards are retained as its established system. Avoid turning numbers into identical metric cards: one progress surface groups the complete history, while action and correction forms are plain sections. Remove the history table to prevent narrow-screen overflow. No flames, leaderboard, red zero, countdown, unsolicited reminders or confetti. Unknown remains distinct from an explicit missed day. The zero-streak state says "Ready" while the lifetime total stays prominent.

Category and twin tests: this is a personal habit record whose correction, excusal and pause actions preserve an honest history, rather than a general engagement dashboard. Removal test: the calendar is functional data and each icon is explained; removing it loses the ability to understand the last seven days.

## Plan v2

Build v1 with a responsive history list, labels rather than tooltips, calm mode that hides runs/milestones, and forms that use installation-local dates from the server. Completed, protected, paused, not planned, unknown and missed have different icons and border shapes. Lifetime totals count completed days only. Late corrections retain their actual dates and real notes. Pause and excused-range operations remain reversible through the underlying coach record.

## Verification

Checked locally: TypeScript, eleven targeted UI tests, desktop 1440, phones 390/360 and reduced motion with the web-design script (run2: zero failures, two warnings). The warnings were compact app body text and the absence of decorative media; the real seven-day calendar is the visual material. A final typography pass uses 16px explanatory text. Run3 screenshots include that final pass; its initial normal desktop requests failed with Chrome's ERR_INSUFFICIENT_RESOURCES and produced a blank screenshot. That run's mechanical report is not a pass. Desktop-first/full/slice01 were subsequently recaptured after the actual completion button appeared, and the other viewports rendered normally. This host resource failure is separate from a layout finding.

Additional browser checks at 320px: no horizontal overflow, all visible controls at least 44px, installation date unchanged in an America/Los_Angeles browser, pause/resume and calm interactions, no browser exceptions. Expanded controls and calm mode were also captured. Independent fresh eyes checked the screenshots and requested honest undo wording because undoing a corrected answer can restore an earlier answer; that was fixed. No further design changes were requested.

Screenshots: `C:/godspeed/work/streak-ui-check3/desktop-first.png`, `phone390-first.png`, `phone360-first.png`, `desktop-reduced-first.png`, `phone320-full.png`, `phone320-controls.png`, `phone320-calm.png`. Mechanical report: `C:/godspeed/work/streak-ui-check2/report.json`.

Tests cover labelled calendar dates, calm mode, returning after a break, distinct record gaps, incomplete historical schedules, missing graduation dates, and server-date mutation contracts. Expired unknown gaps use a neutral record-gap label rather than claiming a missed activity. Future date-range excuses are allowed; actual completions are capped at the installation's today. Mutation requests use the listed habit hash to detect concurrent changes. Live deployment, real personal records, real phones, Safari and Firefox were not exercised by this local check.
