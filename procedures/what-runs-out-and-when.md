# What runs out, and when (Chapter 27)

You already know the failure. A reminder goes off about something you did last
week. You dismiss it. A month later one goes off about something you have not
done, and you dismiss that one too, at the same speed, for the same reason.

The reminder was not wrong. It just had no way of knowing.

**You do not need a Google account, a calendar, or any online service for
anything on this card.** If you have a calendar you can wire two small extras in
at the end. Skip them and you lose nothing.

## Three dates, and you usually need one

Everything in `due/` can carry up to three dates:

- **The day you can start.** Leave it out and it is today.
- **The day you would like it done.** A target. Soft: missing it costs nothing.
- **The day it starts costing you.** A deadline. Hard: a fee, a fine, a lost chance.

You need at least a target or a deadline. Plenty of things only have a target:
the present to buy before a birthday, the fence you want painted before summer.
A tax return has both: you aim for the end of January, and you must be done by
the end of February.

**A target alone** stays quiet until its day and is mentioned once on it. If the
day passes, it never gets louder. The next morning it asks you once, "A new date,
or as soon as you can?" A new date becomes the new target. "As soon as you can",
or no answer at all, keeps it open with a gentle line in your brief about once a
week until you finish it or drop it. It never gets louder than that line,
and it always comes after every deadline in your morning's three places.

**A target and a deadline** behave like the deadline, plus one mention on the
target day. After the target the line says you are past it and names the
deadline. It does not ask for a new date: the deadline decides.

## A deadline is a window, not a due date

For a deadline, write down two dates, not one. **The first day you can do it, and
the last day you still can.**

That second date is the one everybody writes. The first one is what makes the
whole thing work, because now there is a *window*, and a window has a fraction
left, and a fraction is something a computer can be quiet or loud about.

```
        window opens                                          last day
             |------------------------------------------------|
             |<---- quiet ---->|<-- soon -->|<-quicker->|loud--|
                   first half     to a quarter   to a tenth
```

Your mission control says nothing for the first half. A line now and then through the second
half. Its own line in the last quarter. Every single morning in the last tenth,
and always on the last day whatever the arithmetic says.

**One rule, whether the window is a week or a year.** That is the point of it. A
monthly timesheet you can file from the 1st to the 28th goes quiet, gentle,
pushy, loud, all by itself. A tax return you have fourteen months for does the
same thing at its own speed. Nothing is set per item. Nothing to tune, nothing
to forget to tune.

If something ever feels like it needs its own setting, **the window is wrong,
not the rule.** Fix the window. A target adds no setting either: every target
behaves the same way.

## The four questions, and you answer them once

```
mc-due add car-service --title "Car service before the warranty runs out" \
  --from 2026-09-01 --to 2027-02-28 \
  --done-when "The car has been serviced at a garage the warranty accepts." \
  --cost "The warranty ends. A gearbox after that is mine to pay for." \
  --repeats yearly

mc-due add present --title "Birthday present for Nadia" --target 2027-05-10 \
  --done-when "The present is bought and wrapped."
```

That is four answers in one line:

1. **What is true when this is finished?** (`--done-when`)
2. **Is there a day after which this costs you something, or is it a day you'd
   like to have it done by?** (`--to` for the first, `--target` for the second,
   both if both; `--from` only when you cannot start today)
3. **What does it cost you if it slips?** (`--cost`, only with a deadline: a
   target costs nothing when you miss it)
4. **How could your mission control tell you did it, without asking?** (below)

You are never asked again. Everything the thing does for the rest of its life is
judged against those answers.

Or say it in words, in a session with your folder attached:

```
Add something with a day to my mission control. Read existing relevant records first, then ask only for missing facts: what counts as finished; "Is there a day after which this costs you something, or is it a day you'd like to have it done by?" (it can be both; ask which day I can start only if it is not today); what it costs me if it slips, only when there is a deadline; and whether any available evidence can reliably establish completion.

Keep the two kinds of day apart: never turn a day I would like it done into a deadline, or the reverse. If I can give neither, say so and add nothing. Use manual completion, --self-check none, unless we have explicitly tested a better completion signal. Do not treat a recently edited draft or a new backup file as proof that the work succeeded.

Check mc-due --help, then use mc-due add with a unique simple name, --target, --to or both, and my confirmed answers. Show the saved dates and completion condition. Do not create a second reminder schedule.
```

*Bookmark the prompt, if you like: [querino.ai/prompts/add-a-deadline-to-my-mission-control](https://querino.ai/prompts/add-a-deadline-to-my-mission-control)*

When a target has passed and your brief asks "A new date, or as soon as you
can?", just answer your assistant in words ("make it the 20th", "as soon as I
can"). It records the answer with `mc-due target`. Saying nothing is also an
answer: it means as soon as you can.

## Question four is the whole card

Some things can tell you they are done.

- A key was replaced: the date in `secrets/expires.txt` moved.
- A backup happened: the file is newer than the window.
- The accountant replied: the email is in your inbox.

Those close themselves. The moment you act, the nagging stops, without you
telling anything anything. That is not a nice extra. **That is the failure that
kills every reminder app**, fixed.

Most things cannot. Nobody can tell your mission control that you filed a timesheet into
your employer's website. Those wait for your word:

```
mc-due done car-service --evidence "the garage invoice, 12 January"
```

That does not change the file in `due/`. It writes one small note in `world/events/`
saying the thing was finished and what shows it, and everything that asks "is this
still open" reads that note. One place for the answer, so nothing can disagree.

**When you do it with your assistant, it closes it for you.** If you approve,
send or publish the thing in a working session, that is your word, and the
assistant closes it before the session ends instead of asking you to say so again
later. In Claude Code a stop check (`.claude/hooks/obligation-close-check.js`, in
your mission control) makes sure it does, once per deadline per session. It never
reminds you of a deadline the session did not finish, and it leaves a key to the check
that already notices the date in `secrets/expires.txt` moving. Hermes,
Codex and OpenClaw have no such stop, so the instruction is simply: close it in the
same turn you finished it.

**Both answers are fine.** What is not fine is skipping the question, because
the answer changes what you build. Ask it every time, even when you already know
it is "it cannot", and write "it cannot" down.

Today the program can check one thing by itself: whether a file changed inside
the window. It also picks up your key dates on its own (below). Everything else
waits for you, and says so on screen rather than pretending.

## No date, not eligible

`mc-due add` refuses anything that has neither a target nor a deadline, in
exactly those words.

That refusal is the only thing between this and a to-do app you abandon in three
weeks. A shopping list of vague intentions gets ignored, and once you are
ignoring the list you are ignoring the tax return in it too. **A real day, a day
you would like it done or a day it starts costing you, or nothing.** "Someday" is
not a day.

## Three states, and only three

**Open. Done. Dropped.**

Done can happen by itself, when there is a self check. Dropped only ever comes
from you, which is why the command makes you type it out. Nothing is deleted:
the file stays as the record of what you planned, and a note in `world/events/`
says you called it off:

```
mc-due drop car-service --yes
```

A window that closed without being done **stays open**. Nothing sweeps it away
after a while, because for a deadline "nobody got round to it" is the failure and
not a quiet success. It stays in the full list until you close it or drop it. Your
brief mentions it twice more, three days apart, and then waits for your word,
because the likeliest reason is that you did it and forgot to say so.

## Three a day, and the honest week

Your morning brief reads one command:

```
mc-due today
```

It gives back **at most three**, loudest first, and never the same thing twice in
one day. Everything quiet is invisible.

That cap is the reason you can have a hundred of these. Researchers who studied
reminders inside hospital software found that the chance of a reminder being
acted on **dropped by about 30% for each extra one in the same batch**. Six good
reminders are worse than three. Ten are worse than none, because by then you are
not reading any of them.

And when more than three run out in the same week, you do not get four lines. You
get one:

> 5 things run out of time this week, which is more than one morning can carry.
> Pick the two you will really do, and drop or move the rest.

That is not the program giving up. That week's real news is that you took on too
much, and one sentence saying so is more useful than five lines you will scroll
past.

## Wiring it into the brief you already have

Open the chat in your mission control, the one whose brief you set up in Chapter 22,
and paste this:

```
Update skills/morning-brief/SKILL.md with a Deadlines section.

First run mc-due check in the intended mission control, then mc-due today. Preserve any errors or failed-check notices. Include the selected deadline output word for word, including the overload message and all titles. Omit the section only when the command explicitly says nothing needs saying or no deadlines exist, and there was no check error.

That output is the only place the brief speaks about anything in due/. Do not read due/ files yourself, repeat those items in another section, carry them over from an earlier brief, or calculate urgency. A day I would like something done is not a deadline: never call it overdue or urgent. Keep the normal brief body under 200 words, but put required deadline text and check failures after that body without a word limit. Preserve any existing Research section and its unresolved urgent findings. The 200-word target must not delete important material.

Preserve today's existing brief. For testing, use a disposable mission control, its own --godspeed path on every deadline command and a new output at practice/brief-tests/deadline-test.md. Do not add fictional deadlines to my real list or overwrite my real brief.

Run mc-check-brief on the full result. If raw deadline text contains a local path that the checker refuses, preserve the raw output and report the conflict; do not silently alter required text. Use clear human titles when creating deadlines so they do not need local paths.
```

*Bookmark the prompt, if you like: [querino.ai/prompts/put-my-deadlines-in-my-brief](https://querino.ai/prompts/put-my-deadlines-in-my-brief)*

Then check it now rather than in two months. Add something with a made-up last
day a week away, run the brief once, see the line appear, and drop it again.

## Your keys are already in this list

If you did Chapter 31 you have `secrets/expires.txt`, with a line per key and the
date it dies. **`mc-due` reads that same file.** Each key becomes one of these,
with a window running from the day your mission control first learned the date to the date
itself.

So you never write a date in two places, and you have one thing nagging you
rather than two that disagree. Changing the date in `secrets/expires.txt` is
still the off switch it was in Chapter 31, and it is now also the proof: moving
it forward is what replacing a key looks like from the outside, so the reminder
closes itself.

If you took the key paragraph in Chapter 31's card and pasted it into your
morning brief recipe, you can take it back out now. One thing, one place.

## If you do have a calendar

**One entry per thing, and one is the whole rule.**

Not two. Two entries about one date is the same mistake as two reminder apps:
the day they disagree with each other, you stop reading both.

**Which day.** For a target, the target day: the day you chose. For a deadline,
the day your mission control starts being loud, not the day the thing dies, and
the death date goes in the **title**, so the single entry still tells you both
things. A thing with both gets the target-day entry, with the deadline in its
title:

```
Tue 23 July, 09:00
Renew the shop key (it runs out 27 August)
```

An entry on the day the thing dies sounds sensible and is a trap. If you renewed
it three weeks ago, that entry is now a lie sitting in your calendar, and you
have to remember to go and take it out. You will not.

**Take it out when you finish**, as long as its day has not arrived yet: ask
your assistant to, or do it by hand. `mc-due` cannot reach your calendar, so this
part is yours or your assistant's. A day that has already passed is left alone:
that one is a record of what happened. When you move a target, move its entry
with it. This is the half that makes a single entry safe to have at all.

**Give it a real start time**, never an all-day entry, or the rest of your mission control
reads it as background noise and skips it.

**And the other direction.** Write an event on your phone with a line in its
notes like `mission control: from 1 Feb`, and your assistant picks it up on the next morning
run.

That is all of it. **The calendar never decides when you get nagged, and never
knows whether you acted.** Let it do either of those and you are back to a
reminder that goes off about something you did last week.


## Now put it in the register

Open `procedures.md` and add one block: the daily check, what it can reach, and
where the result lands. **One block, not one per deadline**, because there is one
job here however long the list gets.

## Prove it by breaking it (Chapter 20 again)

Two minutes, today, while nothing is urgent.

- Add something with a last day two days from now. Run `mc-due today` and watch
  it come out loud. Drop it again.
- Add something with only a target, dated yesterday. Run `mc-due today` and read
  the one question it asks. Answer "as soon as you can", then drop it.
- Add one with a `file-newer` self check pointing at a file that does not exist.
  Run `mc-due check`, see it stay open. Create the file. Run it again and watch
  it close itself with nobody asked.

Now you know what it looks like when it works, rather than only what it looks
like when it has nothing to say.
