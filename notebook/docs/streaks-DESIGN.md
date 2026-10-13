# Forgiving habit progress

## Expressive redesign, 13 October

Reading this as: an existing habit tool for its owner, in Operate mode, during a quick phone check. Vibe: warm, playful, forgiving, clear. Flat layout because this is an app; the illustration itself has shaded depth.

Brief: Michael called the first graphic dry and complicated. He wants expressive flames on completed days, ice on protected days, and immediate clarity about the tiny action and what can break. The primary action is now "I did it" and uses the existing real completion operation. Paused means "Paused, progress safe", with a resume choice and no activity prompt. All personal numbers remain server facts; the reading preview is explicitly fictional.

### Expressive plan v1

Thesis: a friendly flame greets the next tiny step, while a small permanent bank makes starting again feel worthwhile. Code-native orange/coral flame illustrations with faces and shaded amber bellies, cyan faceted ice around protected flames, and a resting flame on a soft cushion. Shared transparent SVG/PNG pairs live in core/progress-assets/playful, outside the UI, for the web and Telegram renderer.

Extend existing self-hosted Plus Jakarta Sans and DM Sans, app canvas/foreground/muted/border tokens. Warm illustration surface #fff2df, ink #653625, softer ink #8b5b43, action #aa391c, ice #88e7f4. The flame owns the expressive move; other sections are grouped by space and hairlines. No animation beyond press feedback.

Desktop: habit title / flame + run / tiny action + I did it / permanent completed total / seven weekdays with large illustrated states and short dates / two ice inventory illustrations / folded safety, milestones, corrections and settings.

390/320 phone: same order, compact side-by-side flame and run, full-width action button. Week remains seven readable date columns. No dense legend. Plain state words plus spoken full date/status retain meaning without colour. Calm mode removes flame art, runs, ice inventory and milestones.

### Expressive review and plan v2

The first implementation over-weighted lifetime statistics and explained every mechanic before the action. Replace that hierarchy: feeling and action first, lifetime reassurance second, details folded. The flame is a generic progress illustration, not a replacement for the product identity. Ice must show the friendly face through the crystal. Unknown/gap days do not pretend a completion; current unknown is an invitation, older unknown is faded. Active rest days do not claim the whole habit is paused. Preserve actual pause/graduation state independently of calendar status. A clearly labeled "Read one page" fixture provides the active example; the real paused neck habit provides separate truthful verification.

Category/twin/removal: the face represents the user's retained practice; ice is literal protection. Removing them loses the warm emotional signal Michael explicitly asked for. Keep the action and safety copy plain, remove the seven-item key and metric dashboard appearance. No leaderboard, fabricated effort, motion pressure or new reminders.

Root and independent fresh eyes reviewed the expressive example. Their one design batch replaced undone flames with an unlit waiting spark, replaced past unknown flames with neutral dots, removed repetitive Done labels, kept dates at 12px minimum, and simplified ice copy. Real paused and active screenshots then exposed a dark-theme heading inheritance problem, which was corrected explicitly on the warm surface. Current-zero copy invites a next tiny win and future freeze protection rather than claiming a streak can break. The app header uses smaller phone gaps to remove its measured 3px overflow without hiding controls.

Verification: nine focused behavior tests and TypeScript pass. The web-design check has zero failures; its sole warning is absent social preview metadata on a temporary private fixture. Its desktop, 390/360 and reduced-motion images were reviewed, plus 320px actual record screenshots. The full real app is previewed through a temporary local development proxy, using unchanged live records: paused neck habit has one lifetime completion, active walk has three. No habit mutations were made. Both actual states fit at 320/390/1440 with zero page overflow; completion/resume buttons are 44px and above the fold. Expanded correction/settings controls remain at least 44px. Calm mode was checked on explicitly labeled example data and suppresses art, run, ice inventory and milestones.

Evidence: work/artifacts/2026-10-13-forgiving-streaks/expressive-preview/example-390.png, example-320.png, actual-paused-320.png, actual-paused-390.png, actual-active-320.png, actual-active-390.png, actual-active-header-320.png, actual-controls-320.png and example-calm-320.png. Mechanical report: expressive-check2/report.json. The preview is not a deployment or a physical phone check. The earlier verification below describes the superseded first design.

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
