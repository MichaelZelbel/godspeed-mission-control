# Procedures: everything that runs on its own

## The routines your first goal starts

The first time you give your mission control a goal, in the notebook's "Start with one goal" form
or in the chat, it starts three routines on the computer that runs your routines, on your own
clock. It does this once on each computer that runs your routines: if you add a server later and
let it run the routines, the server gets the same three, and your computer's stop. A routine you
later remove stays removed, and a computer whose assistant already had routines of its own gets
none of these.

All of them are listed in your notebook under Settings > Routines, each with what it does, when it
runs next, when it last ran and whether that worked. "Pause" there stops one until you press
"Resume". You can also ask in the chat: "Pause the deadline reminders", "Move the weekly check-in
to Saturday at six".

Where the results go: on a server with Telegram, to your Telegram chat. On your own computer, to
your notebook, in the folder "From your routines", one note per run; a run with nothing to say
leaves no note. The computer has to be on for a routine to run; one it missed runs once when the
computer is back.

### Daily round

Does: every morning it picks the work for today on up to three of your goals and files it (the
next-action recipe, run by mc-decide). Twice a day it does that work, one piece at a time, and
checks each result (the work-item recipe, run by mc-work-run).
Rhythm: "Daily round: choose today's work" every day at 05:30; "Daily round: do the work" every
day at 10:00 and 16:00. Your time zone.
Lands: the day's record in routines/next-action/<date>/decision.md and the work in work/. You get
the record's one line for you ("For you today"), or nothing on a day that needs nothing from you.
With a morning brief switched on, the brief opens with that line instead, so you get it once.
Lives: Hermes' schedule on the computer that runs your routines, working in this folder.
May: read this folder, research on the web, write files here. Anything that reaches another
person, costs money or signs you up waits for your yes.
Off-switch: Pause "Daily round: choose today's work" and "Daily round: do the work" under
Settings > Routines, or pause the goal.
Last checked: 2026-10-09, made by a real Hermes from the notebook's first-goal setup on a test
computer; the morning choice run end to end with a stand-in for the model. A real day's run with
a model is still to be watched.

### Deadline reminders

Does: runs mc-due check, which closes what proves itself done, then mc-due today, and tells you
the dates that need a mention today: at most three, the most pressing first.
Rhythm: every day at 08:00, your time zone. Silent on a day with nothing to say.
Lands: a message to you (Telegram, or a note in "From your routines" on a computer). With a
morning brief switched on, the reminders say nothing and your dates are in the brief's
"Deadlines and targets" section instead, so no date comes twice in a morning.
Lives: Hermes' schedule on the computer that runs your routines. No model is used.
May: read due/ and write the closing of a thing that proved itself done.
Off-switch: Pause "Deadline reminders" under Settings > Routines.
Last checked: 2026-10-09, run once by a real Hermes on a test computer with a practice date and no
morning brief, and its reply kept as a note; quiet on a day the brief carries the dates.

### Weekly check-in

Does: a short coaching talk about your goal, which your mission control starts. It is the coach
area "Weekly check-in" (coach/weekly-check-in/), gentle in tone, and it serves your first goal.
"Coach reminders and habit check" sends the one reminder after a talk you did not answer, and the
evening habit check once you agree on a habit.
Rhythm: Sundays at 18:00 your time, from the Sunday after your first goal. Both are looked at every
15 minutes; the talk starts a model only when it is due.
Lands: on a server, in Telegram. On your own computer the talk waits for you: the next time you
write in the chat, your assistant brings it up. The talk's record is in
coach/weekly-check-in/talks/.
Lives: Hermes' schedule on the computer that runs your routines.
May: read what the talk's area may read, and write the talk's record and habits you agree to.
Off-switch: Pause "Weekly check-in" under Settings > Routines, or say "Pause the weekly
check-in".
Last checked: 2026-10-09, both schedules run once by a real Hermes on a test computer (no talk due,
so both stayed quiet); the talk waiting in the chat tested without Telegram. A talk opened by a
model is still to be watched.

## Notebook service and private file synchronization

The installer can start a separate notebook service at sign-in on Windows or through the isolated Docker Compose project on a server. Its supervisor checks the notebook identity and scheduler progress, restarts only its own unhealthy notebook process, and stops retrying after five failed restarts. The installed stop command or stopping the separate Compose project turns it off.

Once private file synchronization is explicitly configured, the notebook checks it once a minute and after a durable file change. Automatic, manual and notebook connector requests share one synchronization worker. Slow Git network requests run in that worker without holding the local writer lock. Local commits and incoming changes retain the lock, and edits made during upload remain pending for the next cycle. Stopping the notebook terminates the synchronization process tree. File conflicts keep the original and both edited versions; a binary file retains exact bytes and can be resolved by choosing a saved version.

These are installation mechanisms, not adopted personal goals. Personal routines are the three above, which your first goal starts, and the ones you add in the chat or under Settings > Routines; their owner, next run, last run and pause state remain visible there. No routine is claimed tested merely because this description is packaged.

## Goal decisions and approved local work

Does: consumes adopted goals, saved decisions, exact local approvals and checked results. Decisions receive the latest actual report and the current saved deliverable; earlier defects remain history. Selecting the identical completed local edit gets one bounded correction, then fails without queuing another write if repeated. Waiting uses the newest decision by date rather than filename, so unchanged evidence stays quiet until its next check. When the user selects waiting for a separate report, a verified local change remains waiting until an actual later report or a changed goal direction is saved.
Rhythm: with the original assistant, the daily round above runs it; the saved routine controls determine cadence, time zone, owner and pause state.
Lands: goal decisions, work results, tool evidence and forecasts in the notebook.
Lives: the notebook scheduler in the selected installation.
May: read visible knowledge and change only the approved local target. An approved worker must deliver the result without requesting the same approval again. Each attempt distinguishes required source reads from producing the result. A premature result gets one missing-read correction; repeated failures retain their receipts and stop before changing the target. After model calls, result and failure recording wait for an active file writer to finish without repeating the task or holding the writer lock during the model request.
Off-switch: pause Goal decision and Goal work in routine controls, or pause the goal.
Last checked: 2026-10-04, source regressions check required source selection, bounded correction and waiting for a separate report. Installed acceptance remains required.

## Morning briefing and rehearsal

Does: collects selected obligations, watch observations and health records, reads the complete morning note method, checks the written note, and allows one correction before delivery. A rehearsal uses a retained separate copy, including file date evidence for native obligation checks.
Rhythm: not started by your first goal; switch it on in the chat ("Switch on my morning brief") or under Settings > Routines. It opens with the daily round's line for today and carries your dates.
Lands: checked notes and check receipts; rehearsal copies remain in the installation's private runtime folder.
Lives: the notebook scheduler in the selected installation.
May: collect enabled sources, save a checked notebook note and mark included watch findings shown. Rehearsals may change their own copies and send nothing.
Off-switch: pause Morning brief or Brief rehearsal in routine controls.
Last checked: 2026-10-04, source regressions check one rewrite, retained failed checks and rehearsal isolation. Complete collector, final cut and delivery acceptance remains unfinished.

## Structural system review

Does: scores actual context, connections, installed methods and cadence separately, retains evidence and the three highest structural gaps, and compares the previous retained baseline. With a connected assistant, it reads actual recent messages and rules and requires exact source quotes for proposed corrections. Missing memory, peer or comparator evidence stays explicitly unverified.
Rhythm: not scheduled by this template; enable Audit through normal routine controls.
Lands: a dated notebook review, source-check failures and retained previous reports.
Lives: the notebook scheduler in the selected installation.
May: inspect this workspace, visible records and configured connection metadata. Credentials never enter the report. It changes no rules, accounts, other assistant stores or paused routines. An unsupported finding gets one correction before the review fails.
Off-switch: pause Audit in routine controls.
Last checked: 2026-10-04, source tests check four layers, observed connection freshness, retained baselines, credential exclusion, quoted findings, shipped-default exclusion and quiet repeats despite healthy receipt advances. The installed review exposed false default-method credit; corrected installed acceptance and broader system-review scope remain required.

## Personal AI radar

Does: fetches the selected visible watch topics marked radar, checks exact current source quotes and novelty, and retains at most one proposal with an empty user verdict. A quiet run retains its reason. Three wholly unreadable runs produce one warning; later successful reading resolves it.
Rhythm: not scheduled by this template; enable Radar through normal controls and configure the intended source topics.
Lands: source observations, radar run logs and a checked notebook proposal.
Lives: the notebook scheduler in the selected installation.
May: perform read-only public source requests and save local evidence. Credentials in source URLs are rejected and redacted. It never publishes, chooses a verdict or implements its proposed change. One unsupported response gets one correction before failure is retained.
Off-switch: pause Radar in routine controls.
Last checked: 2026-10-04, source regressions use actual local HTTP bytes and check quote rejection, novelty, blind-run warnings and credential exclusion. Installed execution, verdict lifecycle and separate trial implementation remain required.

<!--
The register (Chapter 24). One block per procedure.

The rule: never run a procedure you cannot see and stop. No procedure
exists unless it has a block in this file, and that includes the ones
outside this folder: the email auto-reply, the phone's bedtime routine,
the recurring payment order at the bank.

This file records jobs; it does not start them. Copying it to another
computer installs no schedule. Record only a job you inspected in the
scheduler, and mark a planned one "not scheduled" until it is saved there.

Copy this shape, one block per procedure, below this comment:

## (Name of the procedure)

Does: (what it does and which skill it uses, in your own words).
Rhythm: (schedule, named time zone and next run, or "not scheduled").
Lands: (where the result waits, and where its run history is).
Lives: (which tool runs it, on which computer, in which working folder).
May: (what it may read, change or send).
Off-switch: (the exact pause or removal control, with the job's real name).
Last checked: (date, what was tested, and what is still untested).

Filled example:

## Morning brief

Does: reads my profile files and writes today's brief before I start work;
      skill: skills/morning-brief/SKILL.md.
Rhythm: daily at 07:00, Europe/Berlin; next run tomorrow 07:00.
Lands: brief/YYYY-MM-DD.md in this folder; run history in Hermes.
Lives: Hermes cron, on this laptop, in C:\Users\<you>\godspeed.
May: read this folder, write only into brief/, send nothing.
Off-switch: hermes cron pause morning-brief, or hermes cron remove morning-brief.
Last checked: 2026-09-02, one manual run and one timed test; phone delivery untested.

The example lives inside this comment on purpose. An empty template row
sitting in the open reads like a real procedure, and a register you
cannot trust at a glance is worse than no register.
-->
