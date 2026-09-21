# What runs out, and when (Chapter 27)

You already know the failure. A reminder goes off about something you did last
week. You dismiss it. A month later one goes off about something you have not
done, and you dismiss that one too, at the same speed, for the same reason.

The reminder was not wrong. It just had no way of knowing.

**You do not need a Google account, a calendar, or any online service for
anything on this card.** If you have a calendar you can wire two small extras in
at the end. Skip them and you lose nothing.

## The one idea: a window, not a due date

Write down two dates for everything, not one. **The first day you can do it, and
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

Your hub says nothing for the first half. A line now and then through the second
half. Its own line in the last quarter. Every single morning in the last tenth,
and always on the last day whatever the arithmetic says.

**One rule, whether the window is a week or a year.** That is the point of it. A
monthly timesheet you can file from the 1st to the 28th goes quiet, gentle,
pushy, loud, all by itself. A tax return you have fourteen months for does the
same thing at its own speed. Nothing is set per item. Nothing to tune, nothing
to forget to tune.

If something ever feels like it needs its own setting, **the window is wrong,
not the rule.** Fix the window.

## The four questions, and you answer them once

```
hub-due add car-service --title "Car service before the warranty runs out" \
  --from 2026-09-01 --to 2027-02-28 \
  --done-when "The car has been serviced at a garage the warranty accepts." \
  --cost "The warranty ends. A gearbox after that is mine to pay for." \
  --repeats yearly
```

That is four answers in one line:

1. **What is true when this is finished?** (`--done-when`)
2. **From when to when can you do it?** (`--from`, `--to`)
3. **What does it cost you if it slips?** (`--cost`)
4. **How could your hub tell you did it, without asking?** (below)

You are never asked again. Everything the thing does for the rest of its life is
judged against those answers.

Or say it in words, in a session with your folder attached:

```
Add something with a deadline to my hub. Ask me exactly four questions, once, and never ask them again: (1) what is true when this is finished, (2) from what day to what day can I do it, (3) what does it cost me if it slips, (4) how could you tell I had done it without asking me. If I cannot give you a last day, say so plainly and do not add it: something with no last day is a wish, and this list is not for wishes. Then run hub-due add with my answers, and show me the four answers as you recorded them so I can fix them now rather than in six months.
```

*Bookmark the prompt, if you like: [querino.ai/prompts/add-a-deadline-to-my-hub](https://querino.ai/prompts/add-a-deadline-to-my-hub)*

## Question four is the whole card

Some things can tell you they are done.

- A key was replaced: the date in `secrets/expires.txt` moved.
- A backup happened: the file is newer than the window.
- The accountant replied: the email is in your inbox.

Those close themselves. The moment you act, the nagging stops, without you
telling anything anything. That is not a nice extra. **That is the failure that
kills every reminder app**, fixed.

Most things cannot. Nobody can tell your hub that you filed a timesheet into
your employer's website. Those wait for your word:

```
hub-due done car-service
```

**Both answers are fine.** What is not fine is skipping the question, because
the answer changes what you build. Ask it every time, even when you already know
it is "it cannot", and write "it cannot" down.

Today the program can check one thing by itself: whether a file changed inside
the window. It also picks up your key dates on its own (below). Everything else
waits for you, and says so on screen rather than pretending.

## No date, not eligible

`hub-due add` refuses anything without both dates, in exactly those words.

That refusal is the only thing between this and a to-do app you abandon in three
weeks. A shopping list of vague intentions gets ignored, and once you are
ignoring the list you are ignoring the tax return in it too. **Things with a real
last day and a real consequence, or nothing.**

## Three states, and only three

**Open. Done. Dropped.**

Done can happen by itself, when there is a self check. Dropped only ever comes
from you, and it deletes the file and its whole history, which is why the command
makes you type it out:

```
hub-due drop car-service --yes
```

A window that closed without being done **stays open**. Nothing sweeps it away
after a while, because for a deadline "nobody got round to it" is the failure and
not a quiet success. It sits there, loud, until you close it or drop it. That is
uncomfortable on purpose.

## Three a day, and the honest week

Your morning brief reads one command:

```
hub-due today
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

Open `skills/morning-brief/SKILL.md`, the recipe you wrote in Chapter 22, and paste
this into the session:

```
Open skills/morning-brief/SKILL.md and add one part, near the top. Run the command hub-due today and put whatever it gives back into the brief, word for word, changing nothing and adding nothing. If it says nothing needs saying today, leave the part out entirely rather than writing that nothing is due. Do not work out for yourself which deadlines matter or how many to show: that command already decided, and its cap of three a day is the only reason this stays readable. Change nothing else in the file.
```

*Bookmark the prompt, if you like: [querino.ai/prompts/put-my-deadlines-in-my-brief](https://querino.ai/prompts/put-my-deadlines-in-my-brief)*

Then check it now rather than in two months. Add something with a made-up last
day a week away, run the brief once, see the line appear, and drop it again.

## Your keys are already in this list

If you did Chapter 31 you have `secrets/expires.txt`, with a line per key and the
date it dies. **`hub-due` reads that same file.** Each key becomes one of these,
with a window running from the day your hub first learned the date to the date
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

**Which day.** The day your hub starts being loud, not the day the thing dies.
`hub-due` works that day out from the same rule as everything else, so there is
nothing for you to pick. The death date goes in the **title**, so the single
entry still tells you both things:

```
Tue 23 July, 09:00
Renew the shop key (it runs out 27 August)
```

An entry on the day the thing dies sounds sensible and is a trap. If you renewed
it three weeks ago, that entry is now a lie sitting in your calendar, and you
have to remember to go and take it out. You will not.

**It takes itself out.** When you finish something, your hub deletes its entry,
as long as the day has not arrived yet. A day that has already passed is left
alone: that one is a record of what happened. This is the half that makes a
single entry safe to have at all, because the same thing that stops the nagging
removes the entry.

**Give it a real start time**, never an all-day entry, or the rest of your hub
reads it as background noise and skips it.

**And the other direction.** Write an event on your phone with a line in its
notes like `hub: from 1 Feb`, and your assistant picks it up on the next morning
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

- Add something with a last day two days from now. Run `hub-due today` and watch
  it come out loud. Drop it again.
- Add one with a `file-newer` self check pointing at a file that does not exist.
  Run `hub-due check`, see it stay open. Create the file. Run it again and watch
  it close itself with nobody asked.

Now you know what it looks like when it works, rather than only what it looks
like when it has nothing to say.
