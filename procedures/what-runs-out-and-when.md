# Chapter 27: Track Deadlines Until the Work Is Done

A reminder to do something you finished yesterday is irritating. A reminder that quietly disappears while the work is still waiting is worse. To be useful, a deadline list has to remember whether the job is done, as well as when it's due.

The kit keeps that list in your hub's `due/` folder, using the local command `hub-due`. You don't need to arrange a calendar connection or an online notebook to try it.

## Record the first and last day

Give each deadline a window: the first day you can act and the last day you still can. Say what counts as finished and what happens if you leave it too late. The date is easier to act on when the reminder also explains why it deserves your attention.

```
Add a deadline to my hub. Read existing relevant records first, then ask only for missing facts: what counts as finished, the first and last day I can act, the consequence of delay, and whether any available evidence can reliably establish completion.

Require both dates. Use manual completion, --self-check none, unless we have explicitly tested a better completion signal. Do not treat a recently edited draft or a new backup file as proof that the work succeeded.

Check hub-due --help, then use hub-due add with a unique simple name and my confirmed answers. Show the saved dates and completion condition. Do not create a second reminder schedule.
```


For example, this is the command shape for an invented 14-day practice task. The dates are fixed so the later example is reproducible:

```
hub-due --hub PATH-TO-PRACTICE-HUB add return-form --title "Return the practice form" --from 2026-09-01 --to 2026-09-14 --done-when "The completed form has been accepted" --cost "The practice application misses its deadline" --self-check none
```

Replace `PATH-TO-PRACTICE-HUB` with the full disposable folder path, quoted if it contains spaces. Do not paste this into your real deadline list. Dates use year-month-day, and this command calculates the current day in UTC.

## Run the completion check before selecting today's text

These are two separate commands, in this order:

```
hub-due check
hub-due today
```

The order matters. `check` updates repeating windows and runs any completion checks you've configured. Then `today` chooses what belongs in the brief. If you run only `today`, it hasn't checked whether the work was completed.

Run that pair as part of the morning brief and keep any errors in the result. If a completion check fails, the honest answer is that it couldn't check. Don't let the brief turn that into a completed task.

To inspect the full list, use:

```
hub-due
```

## Tell it when the work is finished

Usually, you'll mark the work done yourself. Once the form has actually been accepted, use:

```
hub-due done return-form
hub-due check
hub-due today
```

For practice, add `--hub` and the practice path to every command. Confirm that the current task is closed and no longer selected. A repeating task can later open a new window.

There is an optional shortcut called `file-newer`, which looks at when a file was modified. It doesn't read the contents. In the version inspected for this book, a modification date on or after the first day of the window closes the task. That means an unfinished draft can look finished to this check.

Use that shortcut only for a file you have tested as evidence of completed work, created after the work succeeds. A fresh backup file might still be incomplete or unusable. An email might acknowledge receipt without accepting what you sent. The signal needs to mean the same thing as “done.”

If you don't have a dependable signal, keep marking completion manually. The full list prints:

> only your word closes this one

## How often a deadline appears

The tool uses four bands. Earlier in the window, reminders can be less frequent. In the last three to fourteen days, depending on the window's length, a task can appear daily. Overdue work remains open.


The exact dates come from the command, including both the first and last day. Short windows can skip a middle band.

For the 1 to 14 September example, with the check run every day from the first day and no competing deadlines, the selection days are **1, 8, 12, 13 and 14 September**. The last three dates are the urgent band. Day 8 is the first selection in the second half. The tool's saved record of earlier selections affects later output.

These are the days the command selects text for your brief. Nothing in this chapter sends a separate phone alert. You can use the local list and brief as they are, then test phone delivery if you add it later.

## Know what the daily limit means

Normally, `hub-due today` selects up to three entries. Call it again on the same day and it may return those entries again. That's useful if you need to rebuild a brief that failed; it isn't meant to invent a fresh reminder on every call.

If more than three open tasks reach the urgent band within the next seven days, the command makes an exception. It prints an overload message with **all affected titles and last dates**. Keep the whole list in the brief. The fourth urgent task doesn't become less urgent because the page was getting long.

The command records that it selected the text when it prints it. It can't tell whether you received or read the brief. Save that output with the day's brief and retry the saved brief if delivery fails, rather than starting another reminder job. If you add a messenger later, test receipt separately.

## Add the full cycle to the brief

```
Update skills/morning-brief/SKILL.md with a Deadlines section.

First run hub-due check in the intended hub, then hub-due today. Preserve any errors or failed-check notices. Include the selected deadline output word for word, including the overload message and all titles. Omit the section only when the command explicitly says nothing needs saying or no deadlines exist, and there was no check error.

Do not calculate urgency yourself. Keep the normal brief body under 200 words, but put required deadline text and check failures after that body without a word limit. Preserve the Research section and its unresolved urgent findings. The 200-word target must not delete important material.

Preserve today's existing brief. For testing, use a disposable hub, its own --hub path on every deadline command and a new output at practice/brief-tests/deadline-test.md. Do not add fictional deadlines to my real list or overwrite my real brief.

Run hub-check-brief on the full result. If raw deadline text contains a local path that the checker refuses, preserve the raw output and report the conflict; do not silently alter required text. Use clear human titles when creating deadlines so they do not need local paths.
```


Test an unfinished task, then a manually completed one. Also test more than three urgent tasks in the practice folder. The full urgent list must survive the brief's length target.

## Drop a task deliberately

Finishing and abandoning are different actions. `done` retains the task's history. `drop` removes the task file and its history:

```
hub-due drop return-form --yes
```

Use the practice path to remove the example. For real work, choose `drop` only when you have decided not to do it. The deadline passing doesn't make that choice on your behalf.

When a deadline moves, ask the assistant to save the existing version and update that entry. Check the new dates and the retained history. A second entry with a slightly different name would leave you with two versions of the same obligation.

## Keep one source for each deadline

Chapter 30 introduces credential expiry dates in `secrets/expires.txt`. The deadline command can read dated entries from that file. Do not also add a manual duplicate or a second expiry countdown to the brief.

After renewing a key, test the actual connection before updating the expiry date and its tracked renewal. A future date in a text file is welcome, but the service still needs to accept the replacement.

Record the daily deadline check inside the morning brief's entry in `procedures.md`; it doesn't need its own schedule. A calendar entry is optional. If you add one, remember to update it when the date changes or the work is done, so it doesn't become the reminder we were trying to avoid.

A useful brief keeps unfinished commitments in view and lets finished work leave the list. Give it a daily run and an honest completion signal. You should be able to spend your attention on doing the work, not explaining repeatedly that you already did it.
