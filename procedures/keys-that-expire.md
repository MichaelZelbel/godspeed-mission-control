# When a key runs out, and how to find out before it does (Chapters 20 and 31)

Chapter 31 locked your keys inside your folder, so connecting a service once
connects it on every computer you own. This card is the part that comes after:
a key is not just a thing you own, it is a thing with a lifespan.

Two jobs, and they are separate. One asks whether your keys are really **on this
computer**. The other asks whether they are still **alive**.

## Job one: is it actually here?

"It is in my folder" and "it is on this computer" are two different claims, and
only the second one makes anything work. The gap between them is silent: your
assistant does not announce that it has no key. It behaves exactly like an
assistant you never connected anything to.

One command answers it:

```
hub-check-keys
```

It asks four questions in order and answers each one in plain words:

1. Does your folder carry any keys? (No is a fine answer. Everything up to
   Chapter 20 works with none.)
2. Can this computer open them?
3. **Would a program you start right now actually get them?** This is the one
   nothing else asks. On Windows it reads the list every new program inherits;
   on a Mac or Linux it starts a fresh terminal and looks at what that terminal
   ends up holding.
4. Is any of them about to run out?

It never prints a key. Names, dates and counts only, so the answer is safe to
read out to somebody or paste into a chat.

Question 3 has a second half worth knowing about: it does not only ask whether
the **name** is there, it checks that the key behind the name is the **current**
one. Replace a key in your folder and forget this computer, and every name is
still present while every value is last year's. That looks identical to working.

## Job two: the date, written down once

Your keys live locked in `secrets/`. Next to them is a plain text file you can
read and edit, `secrets/expires.txt`. One line per key:

```
NAME_OF_THE_KEY     the date it dies     the page you get a new one from
```

For example:

```
SOME_SERVICE_TOKEN  2027-03-14  https://example.com/account/tokens  # what it opens
```

Write `never` instead of a date for one you checked and that does not expire.
Write `-` instead of a page when there is nowhere to go and get one.

**Never put a key itself in that file.** It is plain text and it travels with
your folder. Names, dates, file paths and links only.

The installer makes the file for you, with those instructions inside it. If you
built by hand, make it yourself: it is a text file, and an empty one is valid.

## The one key that does not live in your folder

Nearly every key belongs in the locked store, because putting it there once puts
it on every computer you own. A few must not. A login that belongs to one machine
stops being that machine's login the moment two machines share it, so it stays
where it is, in one file on one computer.

That kind of key still has a last day, and it is the one most likely to die
quietly: no other computer notices, because no other computer has it.

So write it down the same way, and say where it lives with an `@`. Read the `@`
as the word "at":

```
SOME_LOGIN@/the/file/it/lives/in  2027-03-14  -  # what it opens, and how you renew it
```

Everything else is identical. It is counted down on the same rhythm, the date is
still the off switch, and `hub-check-keys` still asks about it. The one thing the
`@` changes is that the check knows not to go looking for it in your folder, so it
never tells you a key is missing when it was never meant to be there.

Where there is no page to get a new one from, write `-` and put the steps in the
words after the `#`. That is the only place they live, and both the check and your
brief point you back at that line.

**One file, not two.** You may be wondering whether a key like this needs its own
list somewhere. It does not. The path in the line IS the declaration: it says this
key lives here, on purpose. A second file to keep in step with the first is the
thing this whole card exists to avoid.

## Why a file and not a calendar reminder

A calendar reminder belongs to one account on one service. It cannot be read by
your morning brief, it does not exist on your other computers, and it disappears
the day you change calendars, which people do.

A date in a file next to the key it is about is read by everything that already
runs. Put it in a calendar as well if you like. Just do not let the calendar be
the only place it exists.

## Wiring it into the brief you already have

Open `skills/morning-brief/SKILL.md`, the recipe you wrote in Chapter 22, and paste
this into the session:

```
Open skills/morning-brief/SKILL.md and add one part. Read secrets/expires.txt, which
lists my keys and the date each one runs out. Work out how many days are left
for each. Say nothing at all about a key with more than 60 days left. Between
60 and 15 days, mention it once a week, on Mondays. With 14 days or fewer,
mention it every morning. Once the date has passed, say every morning that it
is already dead. Each time, give me the plain description from the line, the
date, and the page I get a new one from. Change nothing else in the file.
```

Then check it now rather than in two months. Put a made-up line in
`secrets/expires.txt` with a date a week away, run the brief once, see the line
appear, and take it out again.

## If you have done Chapter 27, skip the wiring above

Chapter 27 builds one daily check over everything in your life with a last day, and
it reads this very file as one of its sources. So a key is in the same list as your
tax return, with the same rhythm worked out from the same rule, and you never write
a date in two places.

If you have that, take the paragraph you just pasted back out of
`skills/morning-brief/SKILL.md` and let `hub-due today` carry keys along with everything
else. **Two things nagging you about the same key is worse than one**, because the
day they disagree you stop believing either.

Everything else on this card stands: the file, the format, `hub-check-keys`, and the
off switch below.

## The rhythm, and why it nags

- More than 60 days: silence.
- 60 to 15 days: once a week.
- 14 days or fewer: every morning.
- Past the date: every morning, saying it is already dead.

One reminder two months out lands on a busy Tuesday and is gone. The escalation
is the point. So is the off switch: **change the date in the file and it stops.**
A nag you cannot stop is noise, and you will start ignoring it right before it
matters.

## When a key does die

Some keys your assistant can replace for you. Many it cannot, and this is worth
knowing before you spend an afternoon on it: for a lot of services, making a new
key needs a human signed in at a website with a browser. There is no command for
it and no way around it. An assistant that says otherwise is about to waste your
time.

So the honest sequence is:

1. You open the page from the third field and make a new key.
2. Your assistant puts it in the locked store, on any computer that can open it.
   This needs no passphrase and no help from you. For a key written with an `@`,
   this step is different: it goes into the file the `@` names, on the computer
   that owns it, and nowhere else. Putting it into a terminal session instead of
   into that file looks exactly like success and is not.
3. You (or it) change the date in `secrets/expires.txt`, which is what stops the
   reminder.
4. Run `hub-check-keys` and read question 3. Being in the store is not being on
   the machine, and step 2 does not finish the job on its own.

## Prove the check by breaking it (Chapter 20)

A check you have only ever seen pass has told you nothing. It might be working.
It might be looking at the wrong thing, or at nothing at all.

So break it on purpose, once, while everything is calm:

- Take one key out of what your computer hands to new programs, run
  `hub-check-keys`, and read the failure. Put it back and watch it pass.
- Put a date from last month in `secrets/expires.txt`, run it, read the failure.
  Put the real date back.
- If you have a key written with an `@`, put yesterday's date on it and run the
  check. It should tell you which computer is being refused and where the key
  lives, and it should never tell you the key is missing from your folder. Put
  the real date back.

Two minutes, and now you know what it looks like when it catches something,
rather than only what it looks like when it has nothing to say. Do the same to
any check you ever come to rely on.
