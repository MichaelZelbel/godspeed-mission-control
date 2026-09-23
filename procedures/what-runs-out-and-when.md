# Chapter 26: Track Deadlines Until the Work Is Done

You finished the job yesterday. This morning, your reminder helpfully asks you to do it again. Meanwhile, another task is still waiting, but its reminder has vanished. Between them, they have managed to ask for the wrong work and forget the right work. A useful deadline list needs to follow what happens after you set the date, so it knows when to persist and when to leave you alone.

The kit keeps that list in `due/` inside your mission control. A helper called `mc-due` manages the dates and reminder selection. Ask the assistant to use it for you; you do not need to manage the commands. No calendar or online memory service is required.

## Record the first and last day

Give each deadline two dates: the first day you can act and the last day you still can. Add what counts as finished and what you'll lose by waiting too long. That last detail earns its place on a busy morning. A reminder labelled 'return form' gives you a chore; knowing that a late form means a failed application gives you a reason to do it.

```
Add a deadline to my mission control. Read existing relevant records first, then ask only for missing facts: what counts as finished, the first and last day I can act, the consequence of delay, and whether any available evidence can reliably establish completion.

Require both dates. Use manual completion, --self-check none, unless we have explicitly tested a better completion signal. Do not treat a recently edited draft or a new backup file as proof that the work succeeded.

Check mc-due --help, then use mc-due add with a unique simple name and my confirmed answers. Show the saved dates and completion condition. Do not create a second reminder schedule.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-27-box-1)*

For example, use an invented form that can be returned from 1 to 14 September. Completion means the form has been accepted, not merely drafted. Ask the assistant to create it in a separate practice mission control and clearly label those fixed dates as a test. Your real deadline needs the actual first and last dates.

## Let the daily check follow the work

Before choosing today's reminders, the assistant must update the list. The helper's `check` operation updates repeating tasks and tests any completion signals you configured. Its `today` operation then selects the text to include in the brief.

That order matters. Selecting reminders without checking completion can keep yesterday's finished work on today's list. A failed check should leave the task open and show the error.

You can ask “Show my deadlines” to inspect the full list. To close one, tell the assistant what actually happened:

```
The return form has been accepted. Mark that deadline done in my mission control, then run the deadline check and show whether it still appears in today's reminders. Keep its history. If you find more than one matching task, ask which one I mean.
```

In practice, tell it to use only the practice mission control. Inspect the result: the task should be closed, with its history still available. A repeating task may open a new period later; completing this month's task does not complete next month's.

## Use evidence that really means finished

By default, your confirmation closes the task. The full list describes that arrangement as:

> only your word closes this one

Automatic completion is optional. One available check, called `file-newer`, looks only at when a file changed. It does not read the contents. Saving a better title in an unfinished draft can therefore look like completion.

Use such a signal only after testing that it matches your definition of done. A newly written backup file may be incomplete. A reply acknowledging receipt may not accept the form. When no reliable signal exists, tell the assistant when you finish.

## How often a deadline appears

The time between your first and last day is the reminder window. The tool divides it into four stages. Early on, reminders are rare. In the last three to fourteen days, depending on the window's length, a task can appear every day. Overdue work stays open.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

The helper calculates the selection dates from the first and last day; the assistant should use that result instead of inventing its own countdown. Starting late or having competing deadlines can change which reminders appear. The full deadline list remains available when you need to inspect everything.

## Know what the daily limit means

Normally, `mc-due today` chooses up to three entries. Call it again that day and you may see the same ones. That lets you rebuild a brief after a failure, without treating every retry as a reason to give you more reminders.

When more than three open tasks reach the urgent stage within seven days, the command prints an overload message with **all affected titles and last dates**. This is an exception to the usual limit of three, so the whole list belongs in the brief.

The command records its selection when it prints the text. Printing a reminder is the extent of its knowledge: it can't tell whether you received or read the brief. Save that output with the day's brief so you can retry a failed delivery without starting another reminder job. If you add a messenger later, check that the message arrives there too.

## Add the full cycle to the brief

```
Update skills/morning-brief/SKILL.md with a Deadlines section.

First run mc-due check in the intended mission control, then mc-due today. Preserve any errors or failed-check notices. Include the selected deadline output word for word, including the overload message and all titles. Omit the section only when the command explicitly says nothing needs saying or no deadlines exist, and there was no check error.

Do not calculate urgency yourself. Keep the normal brief body under 200 words, but put required deadline text and check failures after that body without a word limit. Preserve any existing Research section and its unresolved urgent findings. The 200-word target must not delete important material.

Preserve today's existing brief. For testing, use a disposable mission control, its own --godspeed path on every deadline command and a new output at practice/brief-tests/deadline-test.md. Do not add fictional deadlines to my real list or overwrite my real brief.

Run mc-check-brief on the full result. If raw deadline text contains a local path that the checker refuses, preserve the raw output and report the conflict; do not silently alter required text. Use clear human titles when creating deadlines so they do not need local paths.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-27-box-6)*

Try an unfinished task and then a manually completed one. Add more than three urgent tasks to the practice folder as well, and check that the full urgent list survives the brief's length target. A tidy brief that omits a deadline has saved space at your expense.

## Drop a task deliberately

Finishing and abandoning are different actions. Marking a task done keeps its history. The helper's removal operation, `drop`, removes the task file and its history. Ask the assistant to explain that effect before using it.

If you abandon a task but want the record, ask the assistant to preserve a dated copy first. If only the deadline moves, have it update the existing entry and retain the earlier date in the record. Check the new dates. You want one task with a changed date, without its earlier self continuing to remind you.

## Keep one source for each deadline

The daily deadline check runs within the morning brief, so its details belong in that job's entry in `procedures.md`, with no separate schedule. A calendar entry is optional. If you keep one, update it alongside the deadline when the date changes or the work is done.

Give the list a daily check and a reliable way to know what's done. Then the morning after you finish a job, you get to enjoy having finished it, without a reminder asking you to start.
