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
godspeed-charm context --hook claude
```

Every command takes `--json` (it then prints `{ok, reply, state}`), `--language en|de` for one
reply in that language, and `--words-file <file>` in place of `--words` for words with quotes or
line breaks. Exit 0 means done, 2 means refused with nothing written (the reply says why), 1 is
an error.

## License

MIT
