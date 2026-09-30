# Morning Brief Setup (Chapter 22)

A briefing about your own week, built from your own files, waiting for
you before you start work. Two halves: write the recipe, then hang a
clock on it.

## Half one: the recipe (do this first, always)

First tell your assistant which time zone to use, such as Europe/London.
Then, in a session in Hermes, paste this:

```
Build skills/morning-brief/SKILL.md with these instructions, then run it once.

Read AGENTS.md, the profile, current work files, decisions and inbox. Read the previous brief if there is one. Use the current date in the selected job time zone. Do not invent change over time when there is no earlier record.

Write what changed, useful work you prepared, and the decision that needs me. Separate recorded claims from your recommendations. Include a short draft or question set when the sources support one. Name important gaps and failed checks. Send nothing, buy nothing and make no commitments.

Save a new file as brief/YYYY-MM-DD.md. If it already exists, preserve it and report that no second daily brief was written. For an explicit test, accept a separate practice output path and never use or overwrite today's real brief.

Keep the normal brief body under 200 words. Include copyable action text in the brief itself. Use existing approved HTTPS links for longer material only when available; do not publish private material to make a link. The file a fact came from may be named on a Sources: line.

Keep urgent unfinished work and failed-check notices visible after the normal body when they need more space. These sections are exempt from the 200-word limit. Never cut them to pass the limit. Omit empty sections.

Run mc-check-brief on the completed file, fix delivery-format failures and preserve important content. A passed format check is not an evidence check. If checking fails, report the failure and keep the draft available for inspection.
```

*[Copy prompt](https://querino.ai/prompts/morning-brief)*

The sentences about copyable action text and links are the delivery
contract, and two commands enforce it (both installed with this kit):

- `mc-check-brief` refuses a brief that sends you to a file instead of
  handing you the thing, repeats a link or a line to post from any brief of
  the last 45 days in `brief/`, or hands you a text to send without quotes.
- `mc-judge-brief` asks your assistant, in a clean session that sees nothing
  else, whether a stranger would understand and like each line you are given
  to post, and whether a news story was already in an earlier brief under
  another link. It asks three times about every line, keeps a line only when
  two answers say yes, keeps the best one, and cuts the rest. It only ever
  removes.

The prompt above runs the first. To add the second, paste this as well:

```
Add this to skills/morning-brief/SKILL.md: the full text I would copy is right
there in the brief, in double quotes. After mc-check-brief passes, run
mc-judge-brief on the file, and never put back what it removed.
```

A rule in the recipe can be forgotten by a session; a command cannot. If a
command is missing, run this kit's installer again and it appears.

You get two things: `skills/morning-brief/SKILL.md` (the recipe) and
`brief/YYYY-MM-DD.md` (today's brief, for real).

Run it two or three more times in the same sitting, each time as a test with
a practice output path such as `practice/brief-tests/`, because the recipe
never writes a second brief for the same day: read what came out, edit the
skill file, run it again. The facts differ every morning anyway;
the shape is what you are training, and the loop works best while the
last run is still fresh in your head. Chapter 21's rule: no clock for a
recipe you have not watched run.

## One line worth stealing

Tony Stubblebine, the CEO of Medium, ends his own AI morning briefing
with every file he touched in the past 24 hours. The morning starts
with yesterday's thread back in your hand. Steal it: add one line to
`skills/morning-brief/SKILL.md`:

```
End with one short line naming which files in this folder changed in
the last day. If none did, say nothing.
```

Run the brief once more as a test and check the new closing line.

## Half two: the clock

Once the brief is useful, ask your assistant to schedule it:

```
Set up a daily morning brief at 7am in the time zone we agreed. Inspect existing jobs first. If a morning brief already exists for this mission control, show it and update that job rather than creating a duplicate.

Use this mission control's full path as the job's working folder. Save this job prompt:
Read AGENTS.md in the working folder and follow it. Read skills/morning-brief/SKILL.md and write today's brief to brief/ using that skill. Preserve any existing daily brief. Report unavailable inputs or failed checks. Do not send anything externally.

Keep delivery local. Confirm that the scheduler is running on this computer; a saved job alone is not enough. If it needs setup, explain what must run and configure it within my existing permissions. Do not change other jobs or a shared time-zone setting silently.

Show the saved job's working folder, time zone, next run, result location and pause control. Record these in procedures.md. If any part cannot be checked, say which part and do not describe the schedule as ready.
```

*[Copy prompt](https://querino.ai/prompts/schedule-the-morning-brief)*

The assistant shows you the saved job: its working folder, time zone, next
run, where the result lands and how to pause it. If you would rather type
it, `where-it-runs.md` has the same job as one `hermes cron create` line and
explains what each of its four parts decides.

Then read the job's card. Its **Next** line is the machine repeating your
instruction back. On a laptop the job fires while Hermes is open; a 07:00
the app was shut for is written once, late, when you next open it (see
`where-it-runs.md`). For seven every day without thinking about it,
Chapter 32's server.

## Prove the clock, not just the recipe

Let a one-time test job start by itself, without touching today's brief:

```
Create one one-time test, due in 5 minutes, with this mission control's full path saved as its working folder. Show its saved job record, actual time zone and next run. Its prompt must read AGENTS.md and skills/morning-brief/SKILL.md, then write to practice/brief-tests/timer-test.md as an explicit test output. Refuse to overwrite that file. Use no external delivery. Add the test and its stop control to procedures.md.
```

*[Copy prompt](https://querino.ai/prompts/test-the-timer-separately)*

Keep the computer awake and Hermes running, and do not press **Trigger
now**. Afterwards, ask the assistant to check the run history, the new
practice result, and that no future run is left.

`hermes cron run <name>` fires a job by hand; that proves the recipe and
nothing about the clock (`source=direct`).

## The off-switch

With the name the assistant showed you, here `morning-brief`:

```
hermes cron list
hermes cron pause morning-brief
hermes cron resume morning-brief
hermes cron remove morning-brief
```

Pause takes it off the clock and says `Paused job: morning-brief`; resume
puts it back. Do it once today, so stopping is a reflex. `hermes cron
runs` lists every run with its source and time; `hermes cron incidents`
groups failures (first seen, last seen, the error, the output file), so
you read one entry rather than a log.

## Then the register

The schedule prompt already asks your assistant to record the job in
`procedures.md`: the rhythm, where it lives, and the off-switch. Your house
rules say so too. One glance to confirm.

## Honesty notes

- No new subscription. A run costs what a conversation costs.
- Any frequency you like; no once-an-hour floor. A job fires within a
  minute or so of its slot.
- A missed slot runs once, late, when Hermes is back. A week away comes
  back to one brief, not seven.
- A scheduled job never asks. A dangerous command is refused, not paused
  for approval. A brief that only writes into `brief/` never needs one.
- The recipe is a file in your folder; the schedule lives in Hermes on the
  machine that runs it. That is why the register exists.
- The brief is written by an AI. Chapter 20's habit applies to it like
  everything else.
