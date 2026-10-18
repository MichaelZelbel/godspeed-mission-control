---
name: morning-brief
description: Write today's morning brief into brief/YYYY-MM-DD.md, the short message that reaches the person each morning when they switched it on in setup, with what their watches found. The starter version every mission control ships with; Chapter 25 of the book shows how to replace it with your own. Use when the morning brief job runs, when the person asks for "today's brief", "my brief" or "the brief again", when they answer a list of steps going out (in the brief, or in the daily round's morning message on a day without a brief) with "stop" or "stop" and a number, when they ask to put back a step the brief reported as done without asking, and when they ask to switch the morning brief on.
---

# Morning brief (starter)

This is the starter version. It exists so that a person who said yes to a morning brief
gets a real one from the first morning, before they have shaped it. Chapter 25 of the book
replaces it with the person's own; when they ask you to change what goes into their brief,
edit this file, and from then on it is theirs.

## What to read

Read today's decision record first, `routines/next-action/YYYY-MM-DD/decision.md` for today,
if there is one: its "For you today" section is the daily round's choice. Then read
`AGENTS.md`, everything in `profile/`, the current files in `work/` and `goals/`,
`decisions.md`, and `inbox/`. Read the person's notebook too, where their facts, their people
and their notes are kept: call `get_user_profile` (their facts and the people closest to them)
and `search_brain` for the people, projects and dates the files above name. Without the
notebook tools, read `world/` instead and say in the brief that the notebook was not reached.
Read the previous brief in `brief/` if there is one. Today is the date the terminal gives
(`date +%F`, in the time zone the morning job runs in), also when the brief runs in the
evening: never name a brief for another day. Do not invent change over time when there is no
earlier record.

## What to write

Save a new file as `brief/YYYY-MM-DD.md`. If it already exists, keep it and report that no
second brief was written today. For an explicit test, write to the practice path you are
given and never touch today's real brief.

Write, in plain words:

1. **The one thing that needs them today**, first: the "For you today" section of today's
   decision record, in its own words, with the choice laid out. When the record says nothing
   needs them today, say that in one line with its reason. When there is no record for today,
   leave this part out. The daily round already chose; never choose a second time here.
2. **What changed** since the last brief, from the files, not from memory.
3. **Useful work you prepared**: a short draft or a set of questions, when the files support
   one. Give the full text to copy inside the brief, in double quotes. Never send the person
   to a file path; a phone cannot open one.

Leave out any part that has nothing real in it; never invent a decision to fill the first.
Keep the normal body under 200 words. Separate what the files say from what you recommend.
Name important gaps plainly. Write short plain sentences, without long dashes. Send nothing,
buy nothing, make no commitments.

**When the folder is still nearly empty** (the profile files are the starter's templates, the
notebook holds no facts or people about them, and there is no work yet), say so in one friendly
line, then ask the one question that would help
most, which the person can answer in a sentence of their own, such as "What are you working
on this week?" Never hand them a form with blanks to fill. A short honest brief beats an
invented one.

## Going out tonight

Some steps go out on their own unless the person stops them: kinds of step they allowed once, in
their own words, so they need no yes each time. This brief is where they see each one in time to
stop it. Run `mc-work going-out --json`. When it lists nothing, or `mc-work` is not installed,
leave this section out. Otherwise write it in the person's language, after the first part:

    Going out at <time> unless you say stop:
    1. <what changes where, in plain words> (<its goal, in plain words>)
    2. ...
    Reply "stop" to keep all of them back, or "stop" and a number for one.

Number each line with its `n`, exactly as the list gives it, even when a number is skipped: the
person's reply names that number. The time is each step's `at`, which is UTC: show it in the
person's own time zone, the way they write times (8 pm, or 20:00), and when the steps go out at
different times, give each line its own time. Write `what` as one plain sentence without file
paths. This section does not count toward the 200 words.

When the brief file holds the list, run `mc-work announce <id> <id> ...` with exactly the `id` of
each line you showed, and no other: a step the person was never shown must never go out, and the
mark is what lets a shown step go at its time (one never shown waits for the next morning). If it
names a step it could not mark, take that line out of the brief before you answer. Never announce
for a test brief or when no new brief was written today.

**When they answer it**, here or in the daily round's morning message, which lists the same
steps on a day no brief runs: "stop" (or "stopp", "halt", in their language) with no number keeps
back every step of the day: `mc-work stop --today --words "<their words>"`. "stop 2" keeps back only
line 2: find the `id` whose `n` is 2 in `mc-work going-out --json` and run
`mc-work stop <id> --words "<their words>"` (for several numbers, once for each). Confirm in one
plain sentence what is kept back. When nothing was going out, say "Nothing was going out today."
and run nothing.

## Done yesterday without asking

Some kinds of step the person allowed to go out alone, on their own pages, files and accounts,
without being shown first: this brief is where they hear about them, after. Run
`mc-work went-out --json`: the steps that went out alone and were checked live yesterday. When it
lists nothing, or `mc-work` is not installed, leave this section out. Otherwise write, in the
person's language:

    Done yesterday without asking:
    - <what changed where, in plain words> (<its goal, in plain words>) <its link, if it has one>

Write `what` as one plain sentence without file paths. This section does not count toward the
200 words. When they ask to put one back, what was there before is kept in
`routines/work/<day>/<its id>/before.txt`: put it back at the same place, check the place live, and
say in one sentence that it is back.

## Deadlines and targets

Run `mc-due check`, then `mc-due today`. Put what `mc-due today` prints into a section called
**Deadlines and targets**, word for word, and keep any error it reports. Leave the section out
when it says nothing needs saying and there was no error. This is the only place the brief
speaks about anything in `due/`: never read `due/` yourself, never call something overdue or
urgent on your own. This section does not count toward the 200 words.

## What your watches found

Two kinds of watch keep findings for this brief, and nothing else sends them.

- **Page watches**, the notebook's own (Settings, Sources to watch, or `mc-watch`): run
  `mc-watch pull --channel brief --limit 1 --dry-run`. When it lists a finding, write its `what`
  in plain words with its `link`, and its `next` as the step it suggests. Once the brief file holds
  it, run `mc-watch pull --channel brief --limit 1` so it is marked shown and never comes twice.
  Never mark one shown for a test brief or when no new brief was written today.
- **Research watches**, `watch/<name>/` (the research-watch recipe): read each
  `watch/*/findings.md`. Take the findings whose state is open and whose priority is urgent or
  useful, first seen or changed since the previous brief (all of them when there is no previous
  brief), at most two, urgent first. Write each as one plain sentence with its source link. An open
  finding about a source that could not be read is said as such, never as "no change".

Put them in a section called **What your watches found**, after the first part. Leave it out when
there is nothing new, or when `mc-watch` is not installed and there is no `watch/` folder. This
section does not count toward the 200 words.

## Cycle heads-up

Call `personal_operation {"type":"cycle","action":"brief"}`. When it gives a `line`, put that line
in the brief word for word, as one line, after the first part: it is the person's own heads-up about
their next period, which they switched on themselves. Say nothing else about their cycle, and never
send the line anywhere else. Leave it out when `line` is null or the notebook is not reached. This
line does not count toward the 200 words.

## Checks

Run `mc-check-brief` on the finished file and fix what it refuses, without dropping anything
important. Keep urgent unfinished work and failed-check notices visible after the normal body;
they are exempt from the word limit. If a check fails, say so in the brief.

## Your answer

Your final answer is the brief itself, word for word as the file holds it, and nothing else:
it is what reaches the person. When no new brief was written today, say that in one line.

## Switching it on

When the person asks for the morning brief to run every morning, look at the routine list first
(Hermes' cronjob tool, `list`): a routine that already runs this recipe is kept, not doubled.
Otherwise make one with Hermes' cronjob tool: `action: create`, the name `Morning brief`, the
time they named in their time zone (with none named, 07:00), this recipe attached
(`skills: ["morning-brief"]`), this mission control's folder as `workdir`, and the prompt
`Follow the morning-brief recipe for this mission control.` Never write a prompt that retells
the recipe. To run it once now, follow this recipe yourself, right here, exactly as the routine
will (the same reading, the same notebook calls, the same checks, today's date), and show the
brief you wrote. Never start the routine's own `run` from the chat for this: Hermes runs it in
the background and its answer never comes back to the chat. Add its row to `procedures.md`, and tell
the person when the next one comes, that it appears in the notebook under "From your routines"
(on a server, in their chat), and how to pause it (Settings > Routines).
