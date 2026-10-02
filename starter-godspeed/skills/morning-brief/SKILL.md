---
name: morning-brief
description: Write today's morning brief into brief/YYYY-MM-DD.md, the short message that reaches the person each morning when they switched it on in setup. The starter version every mission control ships with; Chapter 22 of the book shows how to replace it with your own. Use when the morning brief job runs, or when the person asks for "today's brief", "my brief" or "the brief again".
---

# Morning brief (starter)

This is the starter version. It exists so that a person who said yes to a morning brief
gets a real one from the first morning, before they have shaped it. Chapter 22 of the book
replaces it with the person's own; when they ask you to change what goes into their brief,
edit this file, and from then on it is theirs.

## What to read

Read `AGENTS.md`, everything in `profile/`, the current files in `work/` and `goals/`,
`decisions.md`, and `inbox/`. Read the previous brief in `brief/` if there is one. Use the
current date in the time zone the morning job runs in. Do not invent change over time when
there is no earlier record.

## What to write

Save a new file as `brief/YYYY-MM-DD.md`. If it already exists, keep it and report that no
second brief was written today. For an explicit test, write to the practice path you are
given and never touch today's real brief.

Write, in plain words:

1. **What changed** since the last brief, from the files, not from memory.
2. **Useful work you prepared**: a short draft or a set of questions, when the files support
   one. Give the full text to copy inside the brief, in double quotes. Never send the person
   to a file path; a phone cannot open one.
3. **The one decision that needs them**, if there is one, with the choice laid out.

Leave out any part that has nothing real in it; never invent a decision to fill the third.
Keep the normal body under 200 words. Separate what the files say from what you recommend.
Name important gaps plainly. Write short plain sentences, without long dashes. Send nothing,
buy nothing, make no commitments.

**When the folder is still nearly empty** (the profile files are the starter's templates and
there is no work yet), say so in one friendly line, then ask the one question that would help
most, which the person can answer in a sentence of their own, such as "What are you working
on this week?" Never hand them a form with blanks to fill. A short honest brief beats an
invented one.

## Deadlines and targets

Run `mc-due check`, then `mc-due today`. Put what `mc-due today` prints into a section called
**Deadlines and targets**, word for word, and keep any error it reports. Leave the section out
when it says nothing needs saying and there was no error. This is the only place the brief
speaks about anything in `due/`: never read `due/` yourself, never call something overdue or
urgent on your own. This section does not count toward the 200 words.

## Checks

Run `mc-check-brief` on the finished file and fix what it refuses, without dropping anything
important. Keep urgent unfinished work and failed-check notices visible after the normal body;
they are exempt from the word limit. If a check fails, say so in the brief.
