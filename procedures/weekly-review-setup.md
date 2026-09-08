# Chapter 24: Set Up an Automatic Weekly Review

You wrote down the new deadline. Somewhere. Meanwhile, the project file still has the old one, and the assistant has no reason to know which you meant. A weekly review can catch that kind of loose end, file the clear updates and bring you the ones that need a decision.

It can also look past the activity and ask whether the week moved your priorities forward. A week can be exhausting without having done much of that.

## Build a review that preserves its evidence

```
Create skills/weekly-review/SKILL.md with these instructions.

Read AGENTS.md, profile/, decisions.md, inbox/ and the latest earlier review in reviews/. Use available dated work records or version history for comparisons. On the first run, say there is no earlier review; describe the current record without inventing last week's state.

File only clear factual captures. Preserve writing samples, unresolved import questions and other noncapture material. For each filed capture, make the smallest supported update to its proper file, then move the original into archives/filed-captures/ with a unique name. Never overwrite an archive entry. Keep uncertain captures in inbox/. Report source, destination and exact change.

Distinguish a factual update from a proposed behavior rule. Leave proposed rules in inbox/ until I confirm them and the rule workflow is available. A confirmed behavior rule belongs in rules/ and must be compiled with hub-compile-rules; do not hide it in a profile fact or observation. Report any compilation failure.

Before filing, save a local version-history snapshot of the affected files under the hub's rules. If a recoverable snapshot cannot be made, prepare proposed changes without applying them and report why. Send or publish nothing.

Write a new dated review in reviews/. Preserve existing reviews. Include progress toward recorded goals, clear updates filed, unresolved questions, contradictory source lines and one priority to protect. Prepare a useful draft where possible. Do not equate missing records with no work done.

Keep the summary under 250 words. Put the full filing record below it when needed; never omit a move merely to shorten the summary. Skip empty sections.

On the first review of each calendar month, include one optional reminder to use Chapter 1's current context-summary prompt in another AI tool if there is useful new context there. A summary is not a conversation export. Record that the monthly check ran so a same-month retry does not repeat it unnecessarily.

For a test, accept a separate practice destination. Do not replace the real review or file real captures while testing fictional inputs.
```


Read the skill and try it before scheduling. It keeps the original captures in `archives/filed-captures/`, and saves the earlier profile version before changing it. If you disagree with a filing decision, you should have something to go back to.

I first tried this manually with notes for Sam, the fictional illustrator. Nadia was his editor and Priya handled printing. The assistant could file four notes. On the fifth, it stopped to ask:

> `inbox/2026-08-15-thursday.md` ("Keep Thursday free"): which Thursday, and what for?

That was worth asking. “Thursday” didn't give it enough information to choose a date. It also found two lines that disagreed:

> `people.md`: "A rate-increase draft is waiting; the new numbers are not decided yet."
> `projects.md`: "new rates decided, 520 a day, 620 for rush."

Those excerpts come from the earlier test. Its filing instructions removed processed captures; the revised skill above keeps them in an archive. I want you to retain the original note as well as the assistant's interpretation of it.

## Keep the monthly context reminder accurate

There may also be useful background in another AI tool. The prompt in Chapter 1 asked it to summarise what it could reach about you. It didn't export every conversation or collect all your old prompts, so don't expect the weekly review to have those too.

Save that current extraction prompt for later use:

```
Copy the current Chapter 1 prompt from the companion kit's profile/bring-your-context-with-you.md into prompts/library/bring-your-context-with-you.md. Add a purpose line: summarize accessible background for review and import; not a full conversation export. Preserve an existing saved version and show any difference before replacing it.
```

When the reminder comes at a useful time, run the prompt in the other tool. Read and correct its answer before importing, and decide which details you're willing to move. Keep guesses and unanswered questions visible. Familiar information can still arrive with unfamiliar mistakes attached.

## Optional: review what you pay for AI

The weekly review can carry a monthly cost check. Begin with the plans you actually pay for:

```
Read any existing subscription records first. Create or update profile/subscriptions.md with one block per AI plan I confirm: plan name, price and currency, renewal date, source of usage evidence, and status. Keep unknown values marked unknown. Do not duplicate an existing plan or infer that a missing receipt means no usage.
```


Hermes can report recorded usage with:

```
hermes insights --days 30
```

One historical run showed:

> Estimated:   ~$0.50
> Included:    17 session(s) (subscription, no provider invoice)
> Unknown:     4 session(s) (no pricing data)

That number was an estimate for the sessions it had recorded. It couldn't tell me how much allowance I had left unused, or whether a service it hadn't measured cost nothing. A cost review is only as complete as the records behind it.

```
Add an optional monthly subscription section to skills/weekly-review/SKILL.md. Run it only on the first review of the month when profile/subscriptions.md exists.

Read that file and run hermes insights --days 30. Report what the available records cover, known charges and unknown usage. Treat activity in other tools as unmeasured unless their records are available. Distinguish subscription fees from extra usage charges. Recommend a change only with its evidence and tradeoff. Cancel, buy and change nothing. If the command fails, report that failure rather than zero usage.
```


## Schedule it and check the result

Try one review in a practice copy first. Include a writing sample and an unresolved question, then check that both stayed untouched. Also check that you can recover an archived capture and undo its profile change from the saved version. That way, your first wrong filing decision needn't become a detective job.

Then create the real weekly job through **Scheduled jobs**. Use a name such as `weekly review`, a custom schedule such as `every monday 7am`, and this prompt:

```
Read AGENTS.md and follow skills/weekly-review/SKILL.md. Write this week's new review into reviews/. Apply only the local filing allowed by that skill. Report failures and uncertainty; send nothing externally.
```

Check the computer, working folder, time zone, next run and output before leaving the job active. For a local result, keep desktop delivery selected. Write the job into `procedures.md` and try pausing it so you know how to stop it.

The manual run tells you how the skill behaves. You can test the timer with a separate one-time practice job, using a new output file as in Chapter 22. There is no need to wait until next Monday to discover that you chose the wrong folder.

When the real review arrives, read what changed and answer the questions the sources couldn't settle. If a move was wrong, ask to restore that particular change from the saved version. The report should tell you enough to do that without retracing the entire week.
