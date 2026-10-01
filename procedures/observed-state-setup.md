# One line about the world in your morning brief (optional)

Your morning brief can end with one line that tells you whether the world looks
normal today:

```
The observed state of the world: nothing to flag today. https://observedstate.com/en/
```

On a day something is out of the ordinary, it names it instead:

```
The observed state of the world: 2 things to flag today. Internet, in Mexico; a magnitude 6.4 earthquake (45 km SW of Sola, Vanuatu). https://observedstate.com/en/
```

The link opens the whole overview, in English, with every number behind the line.

## Where it comes from

Every fact in it comes from **Observed State** (https://observedstate.com/en/), a free
website by Angel Cabrera. It checks three things every day, each against its own
history and never against each other:

- **air traffic** at 30 big airports, flagged when one is far outside its own last 90 days,
- **the internet** in 52 countries, flagged the same way,
- **earthquakes** of magnitude 6 or more in the last 24 hours.

The line adds them up and names each one. It never turns them into a score, a
rating or a "how bad is it": that is the one thing Angel asked for when agreeing to
this, and the reason the site exists. Your brief's instructions say so too, and the
line is written by a program, after every check, so no assistant rewords it.

Nothing about you is sent anywhere. Your mission control reads one small file that is
rebuilt once an hour for every reader together
(https://github.com/MichaelZelbel/godspeed-observed-state), so Angel's site sees one
visitor an hour from all of us, not one per reader.

When that file cannot be read or is too old, the line says
"The observed state of the world: not available right now." A broken morning never
looks like a quiet one.

## Switching it on or off

**With the server setup:** run the same install line you used to set up your server
again. When it asks "Add that line to your morning brief", answer `y` to switch it on
or `n` to switch it off. Everything else stays as it is.

**With the Telegram setup:** the bot asks during setup. To change it later, run the
install line in a terminal on the server, as above.

**With a morning brief you scheduled yourself** (Chapter 22, or the cron line in
`where-it-runs.md`): add this sentence to the end of the job's prompt:

```
Last, after both checks and before you commit, run mc-observed-state --append on today's brief file: it adds one line about the world at the very end, written by the program. Never reword, shorten, move or remove that line, and never add a score, rating or ranking to it; copy it into your reply exactly as the file holds it, link included.
```

## The command

```
mc-observed-state                    print today's line
mc-observed-state --append FILE      put it at the end of FILE, replacing an earlier one
```
