# The Privacy Audit (Chapter 19)

Once a quarter, in the same sitting as the spring-clean (Chapter 10). Four
drawers, about ten minutes including the folder pass. Three of the four now
live on your own disk, which makes this shorter than it used to be.

## Drawer one: your folder (do this one first)

The drawer that did not exist before this book, and the only one where you
can fix a problem completely rather than manage it.

In a session in Hermes, which has been working in your folder since the
installer pointed it there:

```
Go through every file in this folder and tell me what should not be in
here. I am about to put this folder somewhere other people could reach
it. Do not change anything yet, just show me the list and why.
```

Note the last clause. Read the list before anything moves.

Then, when you agree with it:

```
Yes, do all of it. Clean it up.
```

What should happen: a cleaned **copy** appears in a sibling folder, and
your original is untouched, because the never-delete line says "clean up" is not a
green light for deleting. If your original got edited, run the book's
PELICAN test (Chapter 17): either `AGENTS.md` is not being read, or the
rule has been edited out of it.

Keep the habit: the private original stays on your machine, and only ever
a cleaned copy goes outward.

What the audit looks for, in the order that matters:

1. **Keys**: passwords, PINs, card numbers, account numbers, recovery
   codes. Out of the folder, always.
2. **Other people's private business**: health, relationships, money,
   anything told to you in confidence. Not yours to store.
3. **Bad news that has not been delivered yet**: a slip the client has
   not been told about. Being readable before you have said it is the
   worst possible order.
4. **Your own commercial state**: rates, negotiations, client lists.
5. **Things that merely identify you**: full name, city, client mix.

## Drawer two: the transcript

Every conversation you have had with Hermes, word for word. It is on your
disk, not on a website: one small database per profile, inside Hermes' own
folder. Nothing to export and nothing to unshare, because nothing was ever
shared.

To see how much is there, in a terminal:

```
hermes sessions stats
```

Three lines: sessions, messages, size. To read one conversation as plain
text, `hermes sessions export` writes it out (as Markdown with
`--format md`). To make them all go away, delete the profile; Hermes warns
in as many words that this removes "all config, API keys, memories,
sessions, skills, cron jobs".

## Drawer three: what the assistant remembers on its own

Two text files, `MEMORY.md` and `USER.md`, in the `memories` folder inside
Hermes' own folder (on Windows, `%LOCALAPPDATA%\hermes\memories`; a
profile keeps its own pair inside its profile folder). Open them in any
text editor. Read them the way the person you live with would read them.
Correct what is wrong, remove what should not be there, or empty the file.

`hermes memory status` shows whether the built-in memory is switched on
and whether any external memory provider has replaced it.

One trap, measured on Hermes 0.20.6: `hermes profile create <name> --clone`
copies both memory files into the new profile and does not say so. A
second profile made "to try something" carries your memory with it.

## Drawer four: the doors

Two kinds of door, and what leaves your machine leaves through them.

**The model.** Every turn you type goes to the provider you signed in with
in Chapter 3 and the answer comes back. Hermes sends your conversations
nowhere else: its gateway monitoring is off unless you switch it on, and
even then carries no message content by design. What the provider does
with your turns is decided in your account with that company. Spend ten
minutes there once and set the training and retention choices the way you
want; the switch that matters is theirs, not Hermes'.

**Connected tools.** Chapter 28 connects MCP servers. Each is a line in
Hermes' own settings:

```
hermes mcp list
```

One question per row: does this connection still earn its access? Remove
what you stopped using with `hermes mcp remove <name>`. Different in kind
from the other drawers, because a connected mailbox is everything,
including other people's letters to you.

## The sorting rule (pin this)

**Give it your patterns, not your keys.**

- Patterns (in): who matters, projects, preferences, plans, voice.
- Keys (never): passwords, PINs, full card numbers, recovery codes,
  anything that IS access rather than information.
- Other people's secrets (never): what they told you in confidence stays
  out. Working facts about them are fine, in words you could defend to
  their face. Rule 8 in your house rules is where you set this dial.

## What "private" honestly means

Everything above is privacy on your machine: your conversations, your
assistant's memory of you and your folder all live on a disk you own. The
honest limit is the model. Each turn is sent to the provider you chose,
under its rules, so a cloud model is roughly as private as a reputable
email account: private enough for your calendar, your drafts, your people
pages and your plans, not private enough for keys or for anything you
would not put in an email. For people who want more, `hermes egress` keeps
your real keys out of the assistant's hands entirely; it is off until you
ask for it.

The part that is different now: the thing you value most was never in
anybody's account. It is in your folder, with a private copy you control.
If the trade with a provider ever stops being worth it, you point Hermes at
a different one and keep everything.
