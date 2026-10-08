# Prompts

A prompt is text you typed to an AI to get a job done. This folder keeps them.

**One rule covers everything in here: your assistant never reads this folder on its own.**
It searches it when you ask, and that is all. The rule is in your `AGENTS.md`, and it is
the only reason this folder is safe to have. A log of old requests, read at the start of
every session, is not a log. It is a pile of old orders being taken as new ones.

Two drawers. Each has its own README with the detail.

- **`library/`** is the shelf: the prompts you keep and paste into other tools, one file
  each. You put things here on purpose. Chapters 16 and 38.
- **`archive/`** is the log, and it is optional: if you switched on conversation
  collection, what you typed to the assistants on this computer, and what they answered,
  in date order, filled by a program and never by you. The setup the book teaches leaves
  collection off, so an empty drawer is normal. Chapters 2 and 38.

## How this is different from `skills/`

Both are a text file full of instructions, so the file cannot tell you which it is. One
question can:

> Does my assistant run this itself, here, or do I paste it somewhere else?

If your assistant runs it, it is a skill and it belongs in `skills/`, where the line at the
top of the file is how your assistant knows when to use it. If you paste it somewhere else,
it is a saved prompt and it belongs in `library/`.

A cover prompt meant for a separate image tool is the second kind: you carry it to that
tool, and your assistant here never runs it.

Getting it wrong is quiet in both directions. A saved prompt in `skills/` never fires,
because there is no job in your folder for it to do. A skill in `library/` can never be
found, because nothing reads this folder on its own.

## How this is different from `observations/`

`observations/` is what is true about you now. When one of those files turns out to be wrong you
correct it or delete it, and that is the right thing to do.

A prompt you typed cannot be wrong. It is a record of something that happened, so time can
only make it old, never false. The answer the AI gave is the same kind of thing: on that
day, it replied this. That is why this folder only ever grows, and why `observations/` has no
drawer like `archive/`.
