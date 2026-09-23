# Chapter 23: Set Up an Automatic Weekly Review

Mission Control saves clear updates while you work. A weekly review gives it a different job: look across the week and prepare a useful view of what moved forward, what needs attention and what it can help with next.

It can also resolve any remaining captures when the evidence allows, preserving the originals. You get the useful findings and questions that affect the coming week. Clear updates do not have to wait for this review before Mission Control uses them.

## Build a review that preserves its evidence

```
Create skills/weekly-review/SKILL.md with these instructions.

Read AGENTS.md, profile/, decisions.md, inbox/ and the latest earlier review in reviews/. Use available dated work records or version history for comparisons. On the first run, say there is no earlier review; describe the current record without inventing last week's state.

File only clear factual captures. Preserve writing samples, unresolved import questions and other noncapture material. For each filed capture, make the smallest supported update to its proper file, then move the original into archives/filed-captures/ with a unique name. Never overwrite an archive entry. Keep uncertain captures in inbox/. Report source, destination and exact change.

Distinguish a factual update from a proposed behavior rule. Leave proposed rules in inbox/ until I confirm them. A confirmed behavior rule belongs in rules/ and must be compiled with mc-compile-rules; do not hide it in a profile fact or observation. Report any compilation failure.

Before filing, save a local version-history snapshot of the affected files under Mission Control's rules. If a recoverable snapshot cannot be made, prepare proposed changes without applying them and report why. Send or publish nothing.

Write a new dated review in reviews/. Preserve existing reviews. Include progress toward recorded goals, clear updates filed, unresolved questions, contradictory source lines and one priority to protect. Prepare a useful draft where possible. Do not equate missing records with no work done.

Keep the summary under 250 words. Put the full filing record below it when needed; never omit a move merely to shorten the summary. Skip empty sections.

Only if prompts/library/bring-your-context-with-you.md exists and I still use another AI tool, include one reminder on the first review of the month to bring over useful new background. Do not claim to know what the other tool contains. Record that the reminder was included so a same-month retry does not repeat it.

For a test, accept a separate practice destination. Do not replace the real review or file real captures while testing fictional inputs.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-24-box-1)*

Read the skill and try it before adding a schedule. It asks the assistant to save a version of the affected files and keep original captures in `archives/filed-captures/`. That matters because filing involves interpreting a note. If the assistant puts one in the wrong place, you want your original words and a way back.

My first manual test used notes for Sam, the fictional illustrator. Nadia was his editor; Priya handled printing. Four notes were clear enough to file. The fifth produced a question:

> `inbox/2026-08-15-thursday.md` ("Keep Thursday free"): which Thursday, and what for?

“Thursday” left more than one date to choose from. Asking was better than reserving the wrong day on Sam's behalf. The review also found a disagreement between two files:

> `people.md`: "A rate-increase draft is waiting; the new numbers are not decided yet."
> `projects.md`: "new rates decided, 520 a day, 620 for rush."

Check that the original note reached the archive after its contents were filed. If a statement in the profile looks odd later, you can go back to your own words.

## Optional: bring new background from another AI tool

If you still use another AI tool, useful background can accumulate there while your mission control knows nothing about it. Ask that tool for a summary of who you are, people, priorities, preferences and limits from the material it can reach. Read and correct the result before importing it. This produces a briefing, not a full conversation export.

Save the prompt in your library now so the monthly reminder can point straight to it:

```
From the companion kit's profile/bring-your-context-with-you.md, copy only the first prompt, beginning 'Help me create a short briefing', into prompts/library/bring-your-context-with-you.md. Do not include the correction or download prompts. Add a purpose line: summarize accessible background for review and import; not a full conversation export. Preserve an existing saved version and show any difference before replacing it.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-23-text-2-20260913)*

Use the reminder when there's something worth bringing over. Run the prompt in the other tool, read its answer and correct it before importing. Choose which details may travel, leaving guesses and open questions visible. You know the subject of this summary unusually well, but it can still surprise you.

## Optional: review what you pay for AI

If you pay for more than one AI tool, add a monthly cost check to the weekly review. Begin with the plans you actually pay for, so the assistant can compare usage with the bill:

```
Read any existing subscription records first. Create or update profile/subscriptions.md with one block per AI plan I confirm: plan name, price and currency, renewal date, source of usage evidence, and status. Keep unknown values marked unknown. Do not duplicate an existing plan or infer that a missing receipt means no usage.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-24-box-3)*

Ask the assistant to inspect its usage records for the last 30 days. The helper named `hermes insights --days 30` reads those records; the assistant can run it for you. One historical run showed:

> Estimated:   ~$0.50
> Included:    17 session(s) (subscription, no provider invoice)
> Unknown:     4 session(s) (no pricing data)

That estimate covered sessions Hermes had recorded. It didn't measure unused allowance or work done in tools it couldn't see. The monthly section below keeps subscription fees, extra charges and unknown usage separate so a gap in the records doesn't become a reason to cancel something I use.

```
Add an optional monthly subscription section to skills/weekly-review/SKILL.md. Run it only on the first review of the month when profile/subscriptions.md exists.

Read that file and run hermes insights --days 30. Report what the available records cover, known charges and unknown usage. Treat activity in other tools as unmeasured unless their records are available. Distinguish subscription fees from extra usage charges. Recommend a change only with its evidence and tradeoff. Cancel, buy and change nothing. If the command fails, report that failure rather than zero usage.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-24-box-5)*

## Schedule it and check the result

Ask the assistant to try the review in a practice copy before giving it real captures to file. Include a writing sample and an open question: both should stay put. Have it recover an archived capture, undo that capture's profile change and compare the files with their originals. You'll have checked the ordinary filing and what happens when you disagree with it.

Choose a time when you normally consider the week ahead. Ask the assistant to schedule `weekly review` for that time in your time zone, using this mission control's full path as the working folder. Have it inspect existing jobs first and update a matching job rather than creating a duplicate. Give it this prompt for each run:

```
Read AGENTS.md and follow skills/weekly-review/SKILL.md. Write this week's new review into reviews/. Apply only the local filing allowed by that skill. Report failures and uncertainty; send nothing externally.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-23-text-5-20260913)*

Read the saved job before leaving it active. Its computer, working folder, time zone, next run and output should match what you intended. Keep delivery local. Ask the assistant to record those details in `procedures.md` and pause the job once. This is easier to learn while you are still looking at its controls.

The manual run shows how the skill behaves. To test the timer too, ask for a separate one-time job due in five minutes, using only the practice copy and a new output filename. Keep the scheduler running and let the time pass without triggering it yourself. You can find a wrong folder today instead of waiting for Monday to reveal it.

When the review arrives, read the changes and answer the questions the files couldn't settle. If a note was filed wrongly, restore that change from the saved version. The filing record should make the correction straightforward, leaving you to think about the week ahead instead of reconstructing the one you just lived.
