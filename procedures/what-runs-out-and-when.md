# Chapter 27: Track Deadlines Until the Work Is Done

A reminder can arrive after you finished the work. It can also stop arriving while the work is still unfinished. A deadline list needs to record completion as well as dates.

The kit's `hub-due` command stores that list in your hub's `due/` folder. It runs locally. No calendar or online notebook is required.

## Record the first and last day

A deadline has a window: the first day you can act and the last day you still can. It also needs a clear completion condition and the cost of delay.

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

`check` updates recurring windows and runs configured completion checks. `today` chooses the deadline text for the brief. Running `today` alone does not perform those completion checks.

Run the pair once as part of the morning brief. Keep any check errors visible. If a completion check failed, do not describe its task as done.

To inspect the full list, use:

```
hub-due
```

## Tell it when the work is finished

Manual completion is the normal route. After the form has actually been accepted:

```
hub-due done return-form
hub-due check
hub-due today
```

For practice, add `--hub` and the practice path to every command. Confirm that the current task is closed and no longer selected. A repeating task can later open a new window.

The optional `file-newer` check reads a file's modification date. It does not read the file's contents or establish successful completion. In the inspected implementation, a date on or after the window's first day is enough to close it. Even an unfinished draft can satisfy that rule.

Use it only when the file is a tested completion signal created after the real work succeeds. A newly created backup file, by itself, does not prove that the backup is complete or restorable. A received email does not necessarily mean the promised work was accepted.

If reliable completion evidence is unavailable, keep manual completion. The full list prints:

> only your word closes this one

## How often a deadline appears

The tool uses four bands. Earlier in the window, reminders can be less frequent. In the last three to fourteen days, depending on the window's length, a task can appear daily. Overdue work remains open.


The exact dates come from the command, including both the first and last day. Short windows can skip a middle band.

For the 1 to 14 September example, with the check run every day from the first day and no competing deadlines, the selection days are **1, 8, 12, 13 and 14 September**. The last three dates are the urgent band. Day 8 is the first selection in the second half. The tool's saved record of earlier selections affects later output.

Those are command selections, not phone notifications. This chapter implements a local list and a brief section. It does not implement a separate phone-alert service.

## Know what the daily limit means

Normally `hub-due today` selects up to three entries. If you call it again that day, it can return the same selected entries. That supports recreating a failed brief; it is not a promise that every call sends something new.

There is an exception. If more than three open tasks enter the urgent band within the next seven days, the command prints an overload message and **all affected titles and last dates**. Preserve that list. Hiding the fourth urgent task would make the short brief misleading.

The current command records selection when it prints the text, not when somebody reads or receives the brief. Save that output as part of the one daily brief. If delivery fails, retry that saved brief rather than running another independent notification job. Check delivery separately if you later add a messenger.

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

Use the practice path when cleaning up the example. For real work, drop only after deciding you no longer intend to do it. Passing the last day does not make that decision for you.

For a changed deadline, ask the assistant to inspect and update the existing entry with a saved version first. Do not create a duplicate under a new name. The displayed list should show the new dates and retained history.

## Keep one source for each deadline

Chapter 30 introduces credential expiry dates in `secrets/expires.txt`. The deadline command can read dated entries from that file. Do not also add a manual duplicate or a second expiry countdown to the brief.

Updating an expiry date is still not proof the service accepts the replacement key. Check the actual connection after renewal, then update the existing date and its tracked renewal.

Record the daily deadline cycle within the morning brief's entry in `procedures.md`. It does not need another schedule. A calendar is optional display; if you add an entry, maintain it when the date changes or the task finishes.

The useful result is a brief that keeps unfinished commitments visible and stops treating completed work as unfinished. That needs both a daily run and a trustworthy completion signal.
