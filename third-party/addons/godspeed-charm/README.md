# godspeed-charm

The Charm Challenge for Godspeed Mission Control, from Chapter 12 of *Teach It Once*: 21 days in a
row of charming your assistants into the result instead of arguing with them. Godspeed counts the
days down by itself, notices when you vent at it, still does the work, and asks once: "That
sounded like a slip. Back to 21? Yes / No." Nothing resets without your yes.

The record is a "Charm Challenge" tracker in your Godspeed notebook: every start, question, reset,
kept answer, finish and stop is one row.

## Use

Talk to your assistant:

> start the Charm Challenge

> how is my Charm Challenge?

> charm slip

> I yelled at Copilot again

> stop the Charm Challenge

Or type the command yourself:

```
godspeed-charm start
godspeed-charm status
godspeed-charm slip --words "charm slip"
godspeed-charm stop
godspeed-charm brief                 # the morning brief's line; --no-write for a rehearsal
godspeed-charm config get timezone
godspeed-charm config set language de
```

What the assistant runs for you:

```
godspeed-charm asked --words "why do you give me this garbage?"
godspeed-charm answer yes --words "yes"
godspeed-charm answer no --words "that didn't count"
godspeed-charm context --conversation telegram:123
godspeed-charm context --conversation telegram:123 --stickers   # the sticker plugin is installed
godspeed-charm context --hook claude
godspeed-charm texts      # the question and the button words, as JSON, for the Telegram buttons
godspeed-charm judge --conversation telegram:123 --words-file msg.txt --json   # the Hermes plugin's check
```

Every command but `judge` takes `--json` (it then prints `{ok, reply, state}`; `judge --json` prints
`{ok, verdict: ask|answer|none, answer?, language?, source, why}` and writes nothing), `--language en|de` for one
reply in that language, and `--words-file <file>` in place of `--words` for words with quotes or
line breaks. Exit 0 means done, 2 means refused with nothing written (the reply says why), 1 is
an error. `answer --asked-when <moment>` answers only the open question asked at that moment (the
`when` of the question in `state.open`), and `--asked-seq <n>` its place in the record (`seq`) when two share a moment; the Telegram buttons use both.

## Install

```
node bin/godspeed-charm.mjs setup
node bin/godspeed-charm.mjs check
```

Setup puts the recipe into your skills folder, writes `routines/charm/settings.json` (time zone and
language), installs the `godspeed-charm` command, adds the Hermes plugin when Hermes is there, and
adds the Claude Code hook to `.claude/settings.json`. Every step is safe to run again. It needs
the Godspeed notebook and refuses to install without one.

## Where it works

- The notebook's own chat, through its `charm` operation.
- Telegram, through Hermes: the plugin hands the current state to the assistant before every turn.
  Under Hermes the program, not the model, asks the slip question, on every platform it serves: while
  the model works, the plugin runs `godspeed-charm judge` on your message. A yes or no to an open
  question, a scheduled run, a day with a reset, and "charm slip" are decided by rule. Anything else
  goes to the AI connected in Settings (the installation's `godspeed-model`, 15 seconds) with the
  add-on's own definition of a slip; slip or unsure asks. When that AI is not there, fails or is
  slow, a short list of English and German words of contempt decides. The plugin then records the
  question (`asked`) and ends the reply with it, or records a plain yes or no the model did not.
  If the verdict is not ready 25 seconds after the turn began, the word check decides. Any failure
  sends the reply as the model wrote it. One line per judged turn, without your words, goes to
  `<HERMES_HOME>/logs/godspeed-charm.log`.
  The question after a slip comes as its own message with two buttons, Yes and No (Ja and Nein in
  German); a tap answers it, the message then says what happened, and the buttons go. Only you can
  tap them (the one id in `TELEGRAM_ALLOWED_USERS`), only in your private chat with the bot. Each
  message answers only its own question, and only once: a tap on a question from another day, or
  on one that was answered or asked again since, changes nothing (so does a button from before places were recorded, when two questions
  shared its moment). Typing yes or no works as well.
  The question comes only with a reply that goes out; when no button can be sent, it stays in the
  reply.
  When the hermes-telegram-stickers plugin is installed too, the finish gets one celebration sticker.
- Claude Code, through a UserPromptSubmit hook. Scheduled and assistant-runtime runs get no block.
- Codex gets no block, an accepted limit: there the challenge works only when you ask for it.

## Files

- `routines/charm/settings.json`: your time zone (where a day ends) and the reply language.
- The notebook collection "Charm Challenge": every start, question, reset, kept answer, finish and
  stop is one row. An answer given by a button has "(button)" as its words.
- `.godspeed/charm-turns/`: one small marker per conversation, written when the person's message
  arrives (never for a scheduled run). `asked`, `answer` and `start` given no `--conversation`
  take the one marker written in the last ten minutes; with none or two they refuse and name the
  flag. An explicit `--conversation` always wins. On Hermes the plugin also adds the flag itself.
  A turn the Godspeed notebook runs names its own conversation in `GODSPEED_CHARM_CONVERSATION`:
  commands take it before any marker, the turn leaves no marker, and the notebook, not the
  plugin, records that turn's slip question.
- `.godspeed/charm-buttons/`: one small file per Telegram button (which conversation asked, when,
  and the answer it gives), kept 30 days.

## License

MIT
