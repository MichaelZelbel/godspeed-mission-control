# The prompt log

Everything you have typed to an AI, and what it answered, kept so nothing is
lost. One file per month.

This drawer is not for reading. It is for looking things up. Months from now you
will want to know how you got some result you liked, and the answer is the words
you actually typed at the time. Nobody remembers those. This is where they are.
And half the time what you half remember is not what you typed but what came
back, so the reply is kept beside each prompt.

**Your assistant must never load this folder.** It is a log, not instructions. If
it read the log every session it would drown in old requests and treat them as
things you want done now. The house rule in `AGENTS.md` says so in one line, and
that rule is the only reason this drawer is safe to have.

## The honest limit

The log fills itself only if you use an AI tool that keeps your conversations as
files on your own computer. That means a terminal tool, which is Chapter 28 and
Chapter 30 of the book.

Claude Desktop, the desk the book gives you in Chapter 3, keeps no such store, so
there is nothing for a program to harvest. If that is your only tool, this drawer
stays empty and nothing is broken. Use `prompts/library/` next door instead, and
save the prompts you care about as you go.

## One file per machine, and why that matters

A month file is named after the machine that wrote it, like
`laptop-2026-08.jsonl`. That is not decoration. Each machine can only read its own
conversation logs, so each machine fills its own file, and two machines can never
overwrite each other's.

It also means a machine you did not switch on this month added nothing this month.
That is correct, and worth knowing before you go hunting for something you typed
on the other computer.

## What a month file looks like

One line per prompt, in the order you typed them, in a format made for machines
to search rather than for you to read:

```
{"at": "2026-08-09T14:02:11", "machine": "laptop", "tool": "claude-code", "text": "the prompt you typed", "answer": "what the AI showed back"}
```

`tool` says how you reached the AI, so a line marked `telegram` is one you typed
on your phone and the computer named in `machine` is only where the record was kept.

`answer` holds only text you actually saw on the screen, never the AI's internal
working or the commands it ran. Lines that look like a password are removed, and
a reply longer than about twenty thousand characters is cut short with a marker
saying so.

## How to look something up

Ask your assistant. "Search my prompt log for the one about the invoice
reminder." It searches both drawers, your words and the answers, and shows you
what it found.

Nothing here yet.
