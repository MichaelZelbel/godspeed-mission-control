# Procedures: everything that runs on its own

<!--
The register (Chapter 20). One block per procedure, six facts.

The rule: never run a procedure you cannot see and stop. No procedure
exists unless it has a block in this file, and that includes the ones
outside this folder: the email auto-reply, the phone's bedtime routine,
the recurring payment order at the bank.

Copy this shape, one block per procedure, below this comment:

## (Name of the procedure)

Does: (what it does and what problem it solves, in your own words).
Rhythm: (when it fires).          Lands: (where the result waits).
Lives: (which tool runs it).      Off-switch: (exactly how to stop it).
Last checked: (date).

Filled example:

## Morning brief

Does: reads my profile files and writes today's brief before I start work.
Rhythm: daily, 07:00.             Lands: brief/YYYY-MM-DD.md in this folder.
Lives: Hermes cron, this computer. Off-switch: hermes cron pause morning-brief,
                                  or hermes cron remove morning-brief.
Last checked: 2026-09-02.

The example lives inside this comment on purpose. An empty template row
sitting in the open reads like a real procedure, and a register you
cannot trust at a glance is worse than no register.
-->
