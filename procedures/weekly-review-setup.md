# Weekly Review Setup (Chapter 24)

The procedure that keeps the rest of the system true. It reads your
profile files and your `inbox/`, does the filing itself, reports every
move so you can undo one, and asks you a question only when it finds
something it should not decide alone. Most weeks it asks nothing.

## Half one: the recipe

In a session in Hermes:

```
Build me a weekly review. Write it as a skill file in skills/weekly-review/SKILL.md. When it runs it should read my profile files and everything in inbox/, do the filing itself, and write the review as a new file in reviews/, named with the date, in six parts, the sixth only once a month:
1) what changed in my projects and people since last week, taken only from the files, and where it knows nothing it says so plainly;
2) file each clear capture in inbox/ into the right profile file, in my own words, delete the capture it filed, and report every move as one line naming the source, the destination and what it said, so I can undo a move I dislike;
3) leave anything doubtful in inbox/ untouched and ask me about it, one plain question each; when nothing is doubtful, this part is one line saying so;
4) name anything in my profile files that contradicts itself or has clearly gone stale, quoting both lines; when there is nothing, skip this part entirely;
5) the one thing my priorities say I should protect this week;
6) ONLY when this is the first review of a calendar month: one line reminding me that anything I have told an AI outside this folder can be brought home with the export prompt in prompts/library/bring-your-context-with-you.md. Nothing in the other weeks.

Under 250 words, no pep talk. Then run it once so I can see this week's review.
```

What each part carries:

1. The clause "where it knows nothing it says so plainly" is the most
   important line in the recipe. A review that quietly invents your week
   is worse than no review.
2. Chapter 9's filing prompt, running itself now. Every move is reported
   as one line naming source, destination and words, so undoing one
   costs a sentence.
3. The safety on that trigger: doubt goes to you, always, one plain
   question per capture. Nothing doubtful is ever filed for you.
4. Chapter 10's mirror test, automated: two true files that disagree,
   caught by the thing that reads them side by side every week, quoting
   both lines.
5. Your priorities from Chapter 6, cashed in as a decision about the
   coming week rather than a list.
6. The once-a-month line: a reminder, not a question, that your other
   AIs have been listening too and the export prompt brings those
   conversations home. See `outside-ai-check.md`.

## Half two: the clock

The same line as the brief, with a weekday in the fifth field. `0 7 * * 1`
is Monday at seven:

```
hermes cron create "0 7 * * 1" "Follow skills/weekly-review/SKILL.md and write this week's review into reviews/." --name weekly-review --workdir /path/to/your/hub
```

Your hub as `--workdir`, because the review reads your files just as the
brief does, and because that is what hands the job your `AGENTS.md`.
Sunday evening works as well as Monday morning; pick the moment you
already plan your week. On a laptop the job fires while Hermes is open; a
Monday it was shut for is written once, late, when you next open it (see
`where-it-runs.md`).

You do not need a disposable test copy, because you already ran the
recipe by hand. `hermes cron run weekly-review` fires it once more if you
want to see the job run from the clock's side; it proves the recipe, not
the schedule. No approval pass is needed: a review that only reads and
writes inside your folder reaches for nothing Hermes would ask about, and
a scheduled job that did would be refused rather than left waiting.

## Your half, only when it asks

The review lands with the maintenance in it already done: filed,
reported, undoable. Your half is reading it, and answering what it
actually asked.

1. If it held a capture, answer the question right there, in a plain
   sentence, and it files the answer. Most weeks it holds nothing.
2. If a line under its filed report looks wrong, say so and the move
   comes back out. That is what the one-line reports are for.
3. If it flagged two files disagreeing, one sentence from you settles
   which line is true, so `profile/projects.md` changes while the
   coffee is still warm.

Your context feeds your procedures, and now a procedure feeds your
context. That loop, running by itself, is the closest thing this book has
to a perpetual motion machine.

## Then the register

One block in `procedures.md`. Nothing runs unlisted. Tell your assistant
the job is live and let it write the block; your house rules say so, and
it has often done so already.
