# Procedures: everything that runs on its own

## Notebook service and private file synchronization

The installer can start a separate notebook service at sign-in on Windows or through the isolated Docker Compose project on a server. Its supervisor checks the notebook identity and scheduler progress, restarts only its own unhealthy notebook process, and stops retrying after five failed restarts. The installed stop command or stopping the separate Compose project turns it off.

Once private file synchronization is explicitly configured, the notebook checks it once a minute and after a durable file change. Automatic, manual and notebook connector requests share one synchronization worker. Slow Git network requests run in that worker without holding the local writer lock. Local commits and incoming changes retain the lock, and edits made during upload remain pending for the next cycle. Stopping the notebook terminates the synchronization process tree. File conflicts keep the original and both edited versions; a binary file retains exact bytes and can be resolved by choosing a saved version.

These are installation mechanisms, not adopted personal goals. Personal routines become scheduled only through the saved goal setup and routine controls; their owner, next run and pause state remain visible there. No routine is claimed tested merely because this description is packaged.

## Goal decisions and approved local work

Does: consumes adopted goals, saved decisions, exact local approvals and checked results. Decisions receive the latest actual report and the current saved deliverable; earlier defects remain history. Selecting the identical completed local edit gets one bounded correction, then fails without queuing another write if repeated. Waiting uses the newest decision by date rather than filename, so unchanged evidence stays quiet until its next check. When the user selects waiting for a separate report, a verified local change remains waiting until an actual later report or a changed goal direction is saved.
Rhythm: not scheduled by this template; the saved routine controls determine cadence, time zone, owner and pause state.
Lands: goal decisions, work results, tool evidence and forecasts in the notebook.
Lives: the notebook scheduler in the selected installation.
May: read visible knowledge and change only the approved local target. An approved worker must deliver the result without requesting the same approval again. Each attempt distinguishes required source reads from producing the result. A premature result gets one missing-read correction; repeated failures retain their receipts and stop before changing the target. After model calls, result and failure recording wait for an active file writer to finish without repeating the task or holding the writer lock during the model request.
Off-switch: pause Goal decision and Goal work in routine controls, or pause the goal.
Last checked: 2026-10-04, source regressions check required source selection, bounded correction and waiting for a separate report. Installed acceptance remains required.

## Morning briefing and rehearsal

Does: collects selected obligations, watch observations and health records, reads the complete morning note method, checks the written note, and allows one correction before delivery. A rehearsal uses a retained separate copy, including file date evidence for native obligation checks.
Rhythm: not scheduled by this template; enable only through the saved routine controls.
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
Last checked: 2026-10-04, source tests check four layers, observed connection freshness, retained baselines, credential exclusion and quoted findings. Installed acceptance and broader system-review scope remain required.

<!--
The register (Chapter 21). One block per procedure.

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
