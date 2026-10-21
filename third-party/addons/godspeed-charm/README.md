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
godspeed-charm asked --conversation telegram:123 --words "why do you give me this garbage?"
godspeed-charm answer yes --conversation telegram:123 --words "yes"
godspeed-charm answer no --conversation telegram:123 --words "that didn't count"
godspeed-charm context --conversation telegram:123
godspeed-charm context --conversation telegram:123 --stickers   # the sticker plugin is installed
godspeed-charm context --hook claude
godspeed-charm texts      # the question and the button words, as JSON, for the Telegram buttons
```

Every command takes `--json` (it then prints `{ok, reply, state}`), `--language en|de` for one
reply in that language, and `--words-file <file>` in place of `--words` for words with quotes or
line breaks. Exit 0 means done, 2 means refused with nothing written (the reply says why), 1 is
an error. `answer --asked-when <moment>` answers only the open question asked at that moment (the
`when` of the question in `state.open`); the Telegram buttons use it.

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
  The question after a slip comes as its own message with two buttons, Yes and No (Ja and Nein in
  German); a tap answers it, the message then says what happened, and the buttons go. Only you can
  tap them (the one id in `TELEGRAM_ALLOWED_USERS`), only in your private chat with the bot. Each
  message answers only its own question, and only once: a tap on a question from another day, or
  on one that was answered or asked again since, changes nothing. Typing yes or no works as well.
  The question comes only with a reply that goes out; when no button can be sent, it stays in the
  reply.
  When the hermes-telegram-stickers plugin is installed too, the finish gets one celebration sticker.
- Claude Code, through a UserPromptSubmit hook. Scheduled and assistant-runtime runs get no block.
- Codex gets no block, an accepted limit: there the challenge works only when you ask for it.

## Files

- `routines/charm/settings.json`: your time zone (where a day ends) and the reply language.
- The notebook collection "Charm Challenge": every start, question, reset, kept answer, finish and
  stop is one row. An answer given by a button has "(button)" as its words.
- `.godspeed/charm-buttons/`: one small file per Telegram button (which conversation asked, when,
  and the answer it gives), kept 30 days.

## License

MIT
