# Chapter 10: Keep Your AI's Information Up to Date

A note can outlive the situation it describes. The project ends. A person changes jobs. A deadline moves. The file remains.

Start a review when an answer relies on old information, or when you know the underlying situation changed. Ask the assistant to compare the profile files before editing them.

```
Read the current files in profile/, excluding interview prompts, checklists and templates.

Describe my life and work from those files only: who I am, who matters, active work, priorities and how I want help.

Then list possible conflicts, dates that may be stale, and claims too vague to use. Quote the conflicting lines and name their files. Separate what the files establish from what needs my confirmation.

Do not search elsewhere or change anything yet. Unchanged information is not automatically outdated.
```


## Read the conflicts, not just the portrait

The first half tells you what the assistant can recover from your briefing. The second half compares entries you may have written weeks apart.

In the recorded July practice version, Sam's card-set deadline appeared in two forms:

> **"End of the month" vs 2026-07-28.** `about-me.md` says the card set is due "end of the month". `projects.md` pins it to Tuesday 2026-07-28. Those are 3 days apart. Which one is right?

That was a useful question, not proof that either date was wrong. “End of the month” may have been approximate. The explicit date still needed confirmation.

The same review found a person missing from a related file:

> **Third regular client missing.** `about-me.md` lists three regulars: board-game studio, children's book publisher, and a coffee brand. `people.md` has no coffee brand entry. Either the coffee brand is inactive or the file is incomplete.

Again, there were at least two possible explanations. A review should expose the gap before picking one.

## Make the smallest useful correction

Most findings need one of four moves:

1. **Retire completed work.** Remove it from the active list and keep a dated record if its history matters.
2. **Replace a changed value.** Update the actual deadline or budget where it lives. Do not leave two values presented as current.
3. **Combine vague or repeated notes.** Keep the useful detail and its source. Remove repetition that adds no information.
4. **Confirm slow changes.** Check your background and priorities when they no longer fit. They may remain accurate for months.

Tell the assistant which corrections to make, then inspect the changed lines. For an important change of direction, keep the date and reason in `decisions.md`.

The kit's `profile/spring-clean-checklist.md` is a reference for this work. The task is to improve the current briefing, not to make every file look recently edited.

## Check the cause of a poor answer

Old information is only one possible cause. The assistant may have missed the right file, misunderstood your question or reasoned badly. If the source was already correct, changing it can make the problem worse.

Ask which file and line supported the answer. Compare them with what the assistant claimed. A budget copied correctly from an old note needs an update. A current budget misread by the assistant needs a different repair.

The review also cannot see a private decision you never recorded. Give the short correction when needed and let the assistant file it.

## Check the next use

After changing a priority, start a new session and ask for a recommendation affected by that priority. The answer should use the revised information and explain its source. That is a better check than merely seeing that the file was saved.

Deleting a line removes it from the current briefing. It does not remove earlier Git versions, conversation records or provider copies. Chapter 19 deals with those separate locations.

You now have a way to keep the briefing useful as your life changes. The next chapter is an optional experiment in giving corrections without spending the afternoon arguing with a text box. The build continues in Chapter 12.
