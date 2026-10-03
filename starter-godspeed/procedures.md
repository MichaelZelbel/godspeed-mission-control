# Procedures: everything that runs on its own

## Notebook service and private file synchronization

The installer can start a separate notebook service at sign-in on Windows or through the isolated Docker Compose project on a server. Its supervisor checks the notebook identity and scheduler progress, restarts only its own unhealthy notebook process, and stops retrying after five failed restarts. The installed stop command or stopping the separate Compose project turns it off.

Once private file synchronization is explicitly configured, the notebook checks it once a minute and after a durable file change. Automatic, manual and notebook connector requests share one synchronization worker. Slow Git network requests run in that worker without holding the local writer lock. Local commits and incoming changes retain the lock, and edits made during upload remain pending for the next cycle. Stopping the notebook terminates the synchronization process tree. File conflicts keep the original and both edited versions; a binary file retains exact bytes and can be resolved by choosing a saved version.

These are installation mechanisms, not adopted personal goals. Personal routines become scheduled only through the saved goal setup and routine controls; their owner, next run and pause state remain visible there. No routine is claimed tested merely because this description is packaged.

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
