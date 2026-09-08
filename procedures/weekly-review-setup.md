# Chapter 24: Set Up an Automatic Weekly Review

A new deadline can sit in an inbox note while the project file still shows the old date. The weekly review finds changes like that, files clear updates and leaves uncertain ones for you.

It should also ask whether the work moved toward your priorities. A busy week and a useful week are not always the same.

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


Read and test the skill before scheduling it. The original captures remain recoverable in `archives/filed-captures/`, and the earlier version records what changed in the profile.

An earlier manual test used fictional illustrator Sam's notes. Nadia was the editor; Priya handled printing. Four notes could be filed. One could not:

> `inbox/2026-08-15-thursday.md` ("Keep Thursday free"): which Thursday, and what for?

That is a useful question. The assistant cannot establish the date from “Thursday” alone. The same run found these conflicting lines:

> `people.md`: "A rate-increase draft is waiting; the new numbers are not decided yet."
> `projects.md`: "new rates decided, 520 a day, 620 for rush."

Those are exact excerpts from the earlier test, not a new run of the revised skill. Its older filing instructions removed processed captures. This edition preserves them.

## Keep the monthly context reminder accurate

Chapter 1 asked an AI to summarize the background it could reach. It did not export every conversation or produce a library of your old prompts.

Save that current extraction prompt for later use:

```
Copy the current Chapter 1 prompt from the companion kit's profile/bring-your-context-with-you.md into prompts/library/bring-your-context-with-you.md. Add a purpose line: summarize accessible background for review and import; not a full conversation export. Preserve an existing saved version and show any difference before replacing it.
```

When the reminder is useful, run the prompt in the other tool. Correct the answer and review what may travel before importing it. Leave guesses and unresolved questions visible, as in the first import.

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

That was an estimate for recorded sessions. It did not measure unused allowance or prove that an unmeasured service cost nothing.

```
Add an optional monthly subscription section to skills/weekly-review/SKILL.md. Run it only on the first review of the month when profile/subscriptions.md exists.

Read that file and run hermes insights --days 30. Report what the available records cover, known charges and unknown usage. Treat activity in other tools as unmeasured unless their records are available. Distinguish subscription fees from extra usage charges. Recommend a change only with its evidence and tradeoff. Cancel, buy and change nothing. If the command fails, report that failure rather than zero usage.
```


## Schedule it and check the result

Run the review once in a practice copy to inspect its filing behavior. Include one writing sample and one unresolved question; both must remain untouched. Check that an archived capture and its profile change can be recovered from the saved version.

Then create the real weekly job through **Scheduled jobs**. Use a name such as `weekly review`, a custom schedule such as `every monday 7am`, and this prompt:

```
Read AGENTS.md and follow skills/weekly-review/SKILL.md. Write this week's new review into reviews/. Apply only the local filing allowed by that skill. Report failures and uncertainty; send nothing externally.
```

Confirm the computer, working folder, time zone, next run and output. Leave desktop delivery selected for the local route. Register the job in `procedures.md` and try its pause control.

A manual run tests the skill. A separate one-time practice run tests scheduling without waiting a week. Use a new practice output for that run, as in Chapter 22.

When the real review arrives, read the changes and answer only what the sources could not settle. If a filing decision is wrong, ask for that specific move to be restored from its saved version. The report should make that possible without guessing.
