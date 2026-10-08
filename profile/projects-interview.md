# Projects and Priorities Interview (Chapter 7)

Keeps `profile/projects.md` useful: your mission control reads the work you already have,
names the project that deserves attention and offers help with the next step.

## The prompt

```
Read profile/about-me.md, profile/people.md and profile/projects.md. Use the project list to find relevant drafts, results and recent updates you can access. Read those before asking me for a progress report. Treat practice examples as fiction and keep them out of my real project list.

Give me a short picture of the active work and the next useful step you could help complete. Distinguish agreed deadlines, estimates, current evidence and missing information.

Use priorities I have already stated. If an important choice remains unclear, ask one question at a time, only about what changes the recommendation. Priorities say what matters; they do not tell you my available hours. Do not infer working hours, urgency or permission to spend from a priority.

Update profile/projects.md with clear facts from my updates and verified sources, keeping dates and sources. Ask before replacing a priority with your interpretation. Record a confirmed change of direction and its reason in decisions.md. Keep earlier decisions as history.

Offer concrete help with the next step, such as preparing a draft or comparing options. Prepare the work you can do; get my approval before sending anything or making a commitment.
```

*[Copy prompt](https://querino.ai/prompts/find-the-goals-starting-point)*

The result should name a project, explain why it deserves attention and offer help with the
next step. If the saved material does not show what you are working on, it asks.

## Describe the mess, not the plan

Not "the card set is in progress" but "12 approved, 5 in revision and four days late, 3 not
started."

## Keep the facts apart

- **Priority:** what matters more when two projects compete.
- **Deadline:** when the work is expected. Agreed dates and estimates are marked as which.
- **Available time:** when you can work. A priority does not say this, so the assistant
  asks if your notes and calendar cannot tell it.
- **Limits:** a fixed budget, or an afternoon already promised to someone else.

Write goals down separately and say which are firm and which you are only weighing. A goal
you are only weighing gets a question from time to time, never work.

## What the file should end up holding

```
## Live projects

### [Project]
- **Deadline:** [date, marked agreed or estimate]
- **State:** [real state, including what is late] (source, date)

## What matters most
[Which project wins when two compete, and why.]

## Limits
[Budget, days already promised, anything else that caps the work.]
```

A confirmed change of direction, with its reason, goes into `decisions.md`.

## When a project is not moving

Use this to find the one thing holding the project back, and a small test when the evidence
does not point at one cause.

```
For the project that matters now, name the one thing most likely holding it back, and say what evidence supports that. Then say what observation would show you are wrong about it. If the evidence does not support one cause, propose the smallest test that would settle it. Keep verified facts, inferences and open questions in separate lists.
```

*[Copy prompt](https://querino.ai/prompts/find-what-limits-the-goal)*

## Keeping it true

When you finish a project or put one on hold, tell your mission control during the work. It
updates the project list and keeps the earlier decision with its date and reason. Chapter 11
is the routine; Part V hands it to jobs that run on their own.
