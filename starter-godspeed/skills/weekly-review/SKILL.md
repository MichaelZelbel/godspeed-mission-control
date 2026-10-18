---
name: weekly-review
description: The weekly review. Files the clear notes waiting in inbox/, asks about the unclear ones, catches two pages that disagree, and writes one line on how each goal is going. Use when the weekly review routine runs, when the person asks for their weekly review, or when they ask for one to run by itself ("Run a weekly review for me every Friday").
---

# Weekly review

The review keeps the rest of the mission control true. It does the filing itself, reports every
move so the person can undo one, and asks a question only when it finds something it should not
decide alone. Most weeks it asks little or nothing.

## Setting it up to run by itself

When the person asks for a weekly review on a day and time ("every Friday", "Sunday evening"),
look at the existing routines first and change a matching one instead of adding a second. Then
make one routine named `weekly review` at that day and time in the person's time zone, with this
mission control's folder as its working folder and this prompt:

```
Read AGENTS.md and follow skills/weekly-review/SKILL.md. Write this week's review. Apply only the filing that skill allows. Report failures and uncertainty; send nothing to anyone.
```

Show the person the routine, its next run and how to pause it. With no day named, ask for one
in a single short question; suggest the moment they usually think about the week ahead.

## Every review

1. Read AGENTS.md, the page about the person, their people in the notebook, `profile/`,
   `decisions.md`, `goals/`, `inbox/` and the latest earlier review in `reviews/`. Read the
   notebook with its tools, where the person's facts, people and notes are kept: `get_user_profile`
   for their facts and the people closest to them, `search_contacts` and `search_brain` for the
   people and projects this week touched. A notebook that holds them is not an empty mission
   control, even while the files in `profile/` are still the starter's templates. Without the
   notebook tools, read `world/` and say the notebook was not reached. Use dated work
   records or version history for comparisons. On the first run, say there is no earlier review;
   describe what is there now and never invent last week.
2. File only clear factual news waiting in `inbox/`. For each one, make the smallest supported
   update in its proper place (a person's page, the page about the person, a project, a goal),
   then move the original into `archives/filed-captures/` under a unique name. Never overwrite an
   archived file. Report each move as source, destination and exact change, so one sentence can
   undo it.
3. Keep anything uncertain in `inbox/` and ask about it in one short question that starts with the
   note's file name, such as: `inbox/2026-08-15-thursday.md` ("Keep Thursday free"): which
   Thursday, and what for? Leave writing samples and open import questions where they are.
4. Notes the person made on purpose ("make a note") are their own words, not news. If one of them
   holds a fact that belongs on a page, do not file it: make a review suggestion in the notebook
   that waits for their yes, with the note it came from.
5. When two pages disagree (one says a rate is not decided, another already has the numbers), do
   not pick one. Quote both lines and ask which is true.
6. A proposed rule for how the mission control should behave stays in `inbox/` until the person
   confirms it. A confirmed rule goes into `rules/` and is compiled with `mc-compile-rules`.
7. Before filing, save a version of the files you will change, so any move can be undone. If no
   such version can be made, propose the changes without making them and say why.
8. Write the review into `reviews/` as a new dated file, never replacing an earlier one: one line on
   how each recorded goal is going, the news filed, the questions for the person (first, if they
   asked for that), the pages that disagree, and one priority to protect next week. Missing
   records are not a week of no work; say what is missing instead.
9. Keep the summary under 250 words. Put the full filing record below it when needed, and never
   leave out a move just to keep the summary short. Skip empty sections.
10. Once a month, on the first review of the month, add one reminder: if the person still chats
    with ChatGPT in its own app or with another AI, run the briefing prompt from the start of the
    book there and paste anything new into the chat. Note that you added it, so a second run that
    month does not repeat it.

## Practice and undo

For a test, the person may ask for a practice copy of their pages with made-up notes in its inbox.
Then work only on that copy and never touch the real pages. When asked to undo a move, put the
page back as it was before the review and show the result.

Send or publish nothing. The review changes only the mission control's own files.
