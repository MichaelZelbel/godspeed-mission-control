# Weekly Review Setup (Chapter 27)

The procedure that keeps the rest of the system true. It reads your
profile files and your `inbox/`, does the filing itself, reports every
move so you can undo one, and asks you a question only when it finds
something it should not decide alone. Most weeks it asks nothing.

## Half one: the recipe

In a session in Hermes:

```
Create skills/weekly-review/SKILL.md with these instructions.

Read AGENTS.md, profile/, decisions.md, inbox/ and the latest earlier review in reviews/. Use available dated work records or version history for comparisons. On the first run, say there is no earlier review; describe the current record without inventing last week's state.

File only clear factual captures. Preserve writing samples, unresolved import questions and other noncapture material. For each filed capture, make the smallest supported update to its proper file, then move the original into archives/filed-captures/ with a unique name. Never overwrite an archive entry. Keep uncertain captures in inbox/. Report source, destination and exact change.

Distinguish a factual update from a proposed behavior rule. Leave proposed rules in inbox/ until I confirm them. A confirmed behavior rule belongs in rules/ and must be compiled with mc-compile-rules; do not hide it in a profile fact or observation. Report any compilation failure.

Before filing, save a local version-history snapshot of the affected files under the mission control's rules. If a recoverable snapshot cannot be made, prepare proposed changes without applying them and report why. Send or publish nothing.

Write a new dated review in reviews/. Preserve existing reviews. Include progress toward recorded goals, clear updates filed, unresolved questions, contradictory source lines and one priority to protect. Prepare a useful draft where possible. Do not equate missing records with no work done.

Keep the summary under 250 words. Put the full filing record below it when needed; never omit a move merely to shorten the summary. Skip empty sections.

Only if prompts/library/bring-your-context-with-you.md exists and I still use another AI tool, include one reminder on the first review of the month to bring over useful new background. Do not claim to know what the other tool contains. Record that the reminder was included so a same-month retry does not repeat it.

For a test, accept a separate practice destination. Do not replace the real review or file real captures while testing fictional inputs.
```

*[Copy prompt](https://querino.ai/prompts/weekly-review)*

What each part carries:

1. "On the first run, say there is no earlier review" is the most
   important line in the recipe. A review that quietly invents your week
   is worse than no review, and missing records are not a week of no work.
2. Chapter 10's filing, running itself now. Each clear capture becomes the
   smallest update to its proper file, and the original moves to
   `archives/filed-captures/`, so your own words are never lost. Every move
   is reported as source, destination and exact change.
3. The safety on that trigger: doubt stays in `inbox/` for you, and so do
   writing samples and open import questions. A proposed behavior rule waits
   there until you confirm it, then goes into `rules/` through
   `mc-compile-rules`.
4. The snapshot before filing (Chapter 21), so any move can be undone. If no
   snapshot can be made, it only proposes.
5. Chapter 11's mirror test, automated: contradictory source lines, caught
   by the thing that reads them side by side every week.
6. Your priorities from Chapter 7, cashed in as one priority to protect in
   the coming week, beside progress toward your recorded goals.
7. The once-a-month line: a reminder, not a question, that your other
   AIs have been listening too and the saved prompt brings that background
   home. See `outside-ai-check.md`.

Read the skill, then try it once in a practice copy before it files real
captures. Put in a writing sample and an open question: both should stay
put. Then have it bring back one archived capture and undo that change.

## Half two: the clock

Ask your assistant to schedule a job named `weekly review` for the moment you
already plan your week, in your time zone, with this mission control's full
path as the working folder. Have it inspect existing jobs first and update a
matching one rather than add a duplicate. This is the prompt for each run:

```
Read AGENTS.md and follow skills/weekly-review/SKILL.md. Write this week's new review into reviews/. Apply only the local filing allowed by that skill. Report failures and uncertainty; send nothing externally.
```

*[Copy prompt](https://querino.ai/prompts/run-and-schedule-the-weekly-review)*

To type it instead, use the `hermes cron create` line in `where-it-runs.md`
with `0 7 * * 1` (Monday at seven) and the prompt above.

Your mission control as the working folder, because the review reads your
files just as the brief does. Sunday evening works as well as Monday
morning; pick the moment you already plan your week. On a laptop the job
fires while Hermes is open; a Monday it was shut for is written once, late,
when you next open it (see `where-it-runs.md`).

Read the saved job before leaving it active: its computer, working folder,
time zone, next run and output should match what you meant. Running it by
hand (**Trigger now**, or `hermes cron run` with its name) proves the recipe,
not the schedule. To test the timer too, ask for a separate one-time job due
in five minutes, using only the practice copy and a new output filename, and
let the time pass without triggering it. No approval pass is needed: a review
that only reads and writes inside your folder reaches for nothing Hermes
would ask about, and a scheduled job that did would be refused rather than
left waiting.

## Your half, only when it asks

The review lands with the maintenance in it already done: filed,
reported, undoable. Your half is reading it, and answering what it
actually asked.

1. If it held a capture, answer the question right there, in a plain
   sentence, and it files the answer. Most weeks it holds nothing.
2. If a line under its filed report looks wrong, say so and the change
   comes back out of the saved version. That is what the one-line reports
   are for.
3. If it flagged two files disagreeing, one sentence from you settles
   which line is true, so `profile/projects.md` changes while the
   coffee is still warm.

Your context feeds your procedures, and now a procedure feeds your
context. That loop, running by itself, is the closest thing this book has
to a perpetual motion machine.

## Then the register

One block in `procedures.md`. Nothing runs unlisted. Tell your assistant
the job is live and let it write the block; your house rules say so, and
it has often done so already. Then pause the job once and resume it, while
you are still looking at its controls.
