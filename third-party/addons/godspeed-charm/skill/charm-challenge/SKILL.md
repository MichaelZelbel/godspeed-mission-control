---
name: charm-challenge
description: The Charm Challenge, 21 days of charming your AI into the result instead of arguing with it. Use when the person says "start the Charm Challenge", "Charm Challenge starten", "charm slip", "how is my Charm Challenge", "stop the Charm Challenge"; when they answer yes or no while the [godspeed-charm] block shows an open question for this conversation; and when they tell a story of venting at an AI ("I yelled at Copilot again", "I called ChatGPT useless").
---

## What this is

The Charm Challenge comes from the book *Teach It Once*: 21 days in a row of charming your
assistants into the result instead of arguing with them. Godspeed Mission Control keeps the count
by itself and shows it to you in the `[godspeed-charm]` block. A slip, venting at an AI, sends the
count back to 21, but only after a yes from the person. You do the work they asked for, you ask
once when something sounded like a slip, and you stay warm. No lecture, ever.

## Run the command first, then answer with its reply

Every answer comes from the `godspeed-charm` command. Run it BEFORE you write any reply. When it
succeeds, your reply is its `reply`, exactly: the same words, quotes, numbers and punctuation,
character for character, nothing added and nothing left out. When the person writes German, pass
`--language de` so the reply comes in German; otherwise leave it out. When the command is refused
or fails, never pass its text on as your own: say in one plain sentence that it did not work and
carry on with their request.

**Start:** `godspeed-charm start --conversation "<id from the block>" --words "<their words>"`
(leave out `--conversation` when the block names none). Starting while a challenge runs saves
nothing new; it asks whether to start over, and a yes in this conversation does that.

**How far am I:** `godspeed-charm status`

**A plain slip request ("charm slip", "I slipped"):** `godspeed-charm slip --words "<their words>"`

**Something that sounded like a slip (a story of venting at an AI):** do their work first, then
follow the `[godspeed-charm]` block: ask the one question it gives you and record it with
`godspeed-charm asked --conversation "<id from the block>" --words "<their words>"`.

**Their yes or no to an open question:** `godspeed-charm answer yes --conversation "<id from the
block>" --words "<their words>"`, or `answer no` the same way. Only the conversation that was
asked can answer it.

**Stop for good:** `godspeed-charm stop`

Words with more than one line go in a file of their own, never on the command line: write them,
exactly as they arrived, to a temporary file and pass `--words-file <file>` in place of `--words`.
No shell can cut or change what is in a file.

In the notebook's own chat there is no shell: the notebook offers a `charm` operation that does
the same, and its reply is the answer, exactly as it came.

## Rules

- Never reset the count without a yes. When unsure whether something was a slip, ask once.
- Never ask twice about the same message, and never ask when the block says not to.
- Never lecture, scold, or refuse or delay the work because of a slip. The work comes first.
- "No" is a fine answer. Take it, say the command's reply, never argue back.
- Follow the `[godspeed-charm]` block for everything it says; it knows the count, the open
  question and whether today is the finish day.
