# The monthly question: what are you actually paying for AI? (Chapter 24)

Most people who use AI seriously end up paying for three or four things. One
plan does almost all the work. One or two are quietly costing money every month
for something you stopped using in spring.

You cannot tell which is which by remembering. But Hermes has been keeping the
receipts the whole time, and one command reads them back.

## The receipts you already have

Every conversation Hermes runs, it writes down: which model answered, how much
it read, how much it wrote, and whether that cost anything beyond your
subscription. Nothing to install, nothing to sign up for:

```
hermes insights --days 30
```

The cost section is the part that matters. On the author's machine after a
week on Hermes (2026-09-02, 0.20.6): twenty-three sessions, eighty-five million
units of text, and

```
Estimated:   ~$0.50
Included:    17 session(s) (subscription, no provider invoice)
Unknown:     4 session(s) (no pricing data)
```

The flat subscription carried almost everything and produced no invoice; two
metered models tried on the side added up to the coins; four sessions could not
be priced and were said so, not shown as free.

Two honest limits. `hermes insights` reports what you used, not how much of your
allowance is left: a receipt, not a fuel gauge. And it is per profile, so a
second profile keeps its own receipts.

That is the whole point of this card. Not to find you a cheaper plan. To show
you the sizes, so you worry about the right one.

## What this procedure does

Once a month, four things:

1. Reads your receipts and works out what each plan actually carried.
2. Asks you **one** question, if there is something it cannot work out.
3. Writes you a page you can look at.
4. Tells you if something looks like dead weight, and leaves the decision to you.

## The rule that keeps it honest

**It never tells you which AI is better.**

That changes every month, the tests everyone quotes measure somebody else's
work rather than yours, and an AI asked to compare providers from a web search
will write you a confident paragraph either way. Confident and wrong is worse
than silent.

So it reports two things it cannot be wrong about: what you paid, and what you
used. The choice stays yours. If you want a real comparison, the only one worth
having is ten real jobs from your own month run through both, judged by you.

## Step 1: start the list

In a session in Hermes:

```
Create profile/subscriptions.md. Add one block per AI subscription I pay
for, in this shape, and leave anything I have not told you blank rather
than guessing:

## (name of the plan)
Costs: ($X per month, or blank).  Renews: (a day of the month, or blank).
Receipts: (hermes insights, or none).  Status: active.

The ones I pay for right now are: (list them).
```

Blanks are not a failure. A blank is next month's question.

## Step 2: read the receipts

```
Run hermes insights --days 30 and show me its cost section and its models
table as they are. Do not price anything yourself, and do not tell me
which model is better.
```

You now know something about your own AI use that you did not know before,
and it took one prompt.

## Step 3: make it a monthly habit

Add it to the weekly review you already have, on the first review of the month:

```
Open skills/weekly-review/SKILL.md and add a part that runs ONLY on the first
review of a calendar month: run hermes insights --days 30, read its cost
section and its models table, compare them against profile/subscriptions.md,
and tell me three things. What each plan carried. Anything I am paying for
that carried nothing. And ONE question, if the list cannot answer something
the receipts raise. Never tell me which model is better. Never show a plan
you could not measure as zero, say you could not measure it.
Change nothing else.
```

## The two mistakes to design out, and why

**Never show a plan you cannot measure as zero.** Most consumer plans publish no
receipts at all, and `hermes insights` itself lists sessions it cannot price as
"Unknown", never as free. "I could not see this one" and "$0.00" look identical
on a page, and they point at opposite decisions. One means ask; the other means
cancel. Cancelling on a zero you never measured is the expensive mistake here.

**A unit of work on a flat plan does not cost you money.** This is the one almost
everybody gets backwards, including the author when he first asked the question.
If you pay a fixed fee, using more costs you nothing extra. What runs out is
capacity: the hourly or weekly ceiling. So the question is never "is this plan
cheap". It is "how many times this month did it stop me, and what did that
cost me". The first question has no useful answer. The second one does.

## When it says something looks like dead weight

It should name one specific thing you could do, and then stop. Cancel this.
Downgrade that. Move this work onto the plan already carrying everything else.

It should never do any of them. A procedure that cancels your subscriptions is
a procedure you cannot leave running.
