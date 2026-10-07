# godspeed-journal: interstitial journaling for Godspeed Mission Control

**Journal between tasks, out loud or typed, and let your mission control hold you to what you said.** An add-on for [the kit](https://github.com/MichaelZelbel/teach-it-once-kit) from [*Teach It Once*](https://leanpub.com/teachitonce).
You say what you're starting and what done looks like. When you say you're done, your assistant
checks the two against each other, once, in a few words. When a task runs long, it can check in;
in the evening it can list what's still open. Everything about how much it says is yours to set.

This is for some people, not most. If interstitial journaling isn't a practice you already want,
you don't need this folder.

## What it is

- **One command of its own**, `godspeed-journal`, with a subcommand for each move: `start`,
  `define`, `done`, `drop`, `met`, `reopen`, `note`, `open`, `day`, `week`, `words`, `evidence`,
  `config`. One file per entry, so two devices writing at the same time never collide.
- **One recipe**, `interstitial-journal`, copied into your mission control's skills folder. It
  tells your assistant how to recognise an entry, when to ask what done means, how to check a
  finish against it, and when to stay quiet, which is most of the time.
- **A Hermes plugin** that shows your assistant which tasks are open right before it reads your
  message, and a Hermes job, `godspeed-journal-tick`, that runs every fifteen minutes and only
  ever sends something when a check-in or the evening list is actually due.
- **A Claude Code hook** that does the same thing for a Claude Code session, when your mission
  control has a `.claude` folder.

## What you need

1. Your mission control from the book (or a folder holding an `AGENTS.md`), on Windows, macOS or
   Linux, and Node.js 22 or newer.
2. Hermes (Chapter 32), if you want check-ins and the evening list delivered to a messenger.
   Without it, entries still save; there is just no nudge.

## Install

In a terminal, from anywhere, one line:

```
npx --yes github:MichaelZelbel/godspeed-journal setup
```

Or tell your assistant: *install godspeed-journal from https://github.com/MichaelZelbel/godspeed-journal*.
It runs the line above.

> Assistant: run `npx --yes github:MichaelZelbel/godspeed-journal setup --godspeed <this mission control folder>`
> and pass its questions to the person.

It finds your mission control, copies the recipe into its skills folder and saves that in its own
history, puts the `godspeed-journal` command next to the kit's other commands, wires the Hermes
plugin and the check-in job when Hermes is there, and adds the Claude Code hook when `.claude`
exists. Run the same line again any time; it keeps your settings and any recipe you wrote
yourself under the same name, and touches nothing else.

## Use

Talk to your assistant, mid-work, in your own words:

> Journal: starting the invoice, done means sent and filed

> Journal: invoice done, sent it

> stop the check-ins

The first line opens a task and says what finishing it looks like. The second closes it; your
assistant checks what you said against what you promised and tells you in a line, at most. The
third changes a setting, in this case turning check-ins off, the same way as any other setting
below. A message this recipe recognises starts with "journal", "j:", "track", "log:" or
"Tagebuch" (any case, spoken or typed), or answers a check-in your mission control already sent
you. "Track" is the one to use when you dictate: speech recognition often turns "log" into "look".
When another tracker is installed, "track headache ..." goes to that tracker instead.

Prefer typing it yourself:

```
godspeed-journal start "Edit the invoice" --done-means "sent and filed"
godspeed-journal done "invoice" --met "sent and filed"

# what is still open
godspeed-journal open

# today, task by task
godspeed-journal day

# this week's numbers
godspeed-journal week

# what you said this week, day by day, in your own words
godspeed-journal words

# something you left out at the finish happened after all
godspeed-journal met "letter" --met "letter scanned"

# every setting and its current value
godspeed-journal config show
```

## What happens to what you say

Three things, and nothing else. Writing it down is most of the value; these only make sure
nothing you said is lost.

1. **In the moment.** When you finish, what you said is held against what you said done means,
   once.
2. **Once, that evening.** The evening list names what is still open and anything a finish left
   out. Say it happened and it is settled; say nothing and it is not named again.
3. **In the talks you already have, and whenever you ask.** `week` says where the hours went and
   `words` gives back what you said, in your own words. A weekly talk (for example the coach
   add-on's work talk) reads both. The journal never sends a report on its own and never draws
   conclusions for you.

The hours are counted time. A task's clock runs only while it is the last thing you started or
wrote a note about: starting something else stops it, a note about it starts it again, and any
four hours without an entry stop it at your last entry before them. A task left open overnight
therefore shows as "at least" the time you were seen on it, or "time unknown", never as 26 hours.

## Settings

Say what you want in your own words; your assistant runs `godspeed-journal config set <key>
<value>` and tells you what changed:

- **Check-ins**: on or off, and after how long a task has to run first. "No check-ins" or "check
  in after four hours."
- **Quiet hours**: a stretch of the day check-ins never interrupt. "Quiet after nine."
- **Feedback**: `off` just saves what you say; `check` (the default) also asks what done means
  and checks it when you finish; `coach` adds one reflective question after a finish. "Just save
  it, no comments" or "ask me something to reflect."
- **Length**: `short` is the lines above and nothing more; `long` allows one more plain sentence.
  "Shorter" or "a bit more."
- **Done definition**: whether it asks "what does done look like?" when a task has none yet.
  "Don't ask what done means."
- **Evening list**: off by default (setup asks, or answer straight away with `--evening on|off`),
  and what time it's sent. "No evening list" or "evening list at seven."
- **Weekly summary**: on or off, and which day. "A weekly summary on Sundays."
- **Language**: `en` or `de`, for the check-in and evening texts. "Journal in German."
- **Prefix required**: whether an entry has to start with "journal" (or "j:") to count as one.
  "I don't want to say journal first."

## What a check-in looks like

It arrives on your phone as its own message, often hours after you last thought about the task,
so it says everything it is about: where it comes from, which task and when you started it, what
you said done means, what was looked at, and the exact replies with what each one does.

> From your journal: yesterday at 22:09 you started "Substack post". You said it is done when: all
> Substack texts in the project; post page open. Nothing has gone out on Substack since. Nothing
> about it has been noted since.
> Is it done, or are you still on it? Reply "done" and I'll check it against what you said done
> means, reply "still on it" and it stays open, or tell me what you're doing instead. No reply is
> fine: it stays open and I won't ask about it again.

The evening list does the same for everything still open. Your assistant never asks about an open
task in the middle of a conversation about something else: a question glued to the end of an
unrelated answer does not say what it is about, and until 0.4.0, when the journal still offered
one, nobody could answer it.

## Already on record

Your journal never asks whether you finished something your own systems already show you
finished. Before a check-in and before the evening list, it looks at the record. For each open task, one of four things follows:

- **The record plainly shows it finished**: the task is closed with the proof (a link), and nobody
  asks. Your assistant sees it under "Closed from the record" for the next twelve hours, so it
  never asks about it either.
- **The record shows something related, but not plainly this task**: it is neither closed nor
  asked about. Leaving it alone is cheaper than a wrong guess in either direction.
- **The record could not be read**: nothing is asked about that task this time; it is looked at
  again on the next check.
- **Nothing on record**: the check-in goes out, and it says what was looked at.

What counts as the record:

- **Posts that went out**, from a program you name once (see below). A post closes a task only
  when the task names that platform and no other (in its title or in what done means), no other
  open task names that platform, and it is the one post there since the task started. Platforms
  are recognised by names that cannot mean anything else, so "Twitter" works and "X" does not.
- **Your mission control's own history and its `world/events/`.** Words are never proof, so a
  commit or an event that sounds like a task only keeps the journal from asking about it; it never
  closes it. An event that says something *started* does not count at all.

If a task was closed that you did not finish, tell your assistant ("that one's not done"); it runs
`godspeed-journal reopen <task>`, and the same proof never closes it again.

**Naming the post program.** `godspeed-journal config set evidence.script <path>`, a path inside
your mission control (a `.js` or `.mjs` file runs with Node, anything else must be executable).
The journal runs it only when an open task names a platform, with two variables set:
`GODSPEED_JOURNAL_SINCE` (the oldest such task's start, ISO time) and `GODSPEED_JOURNAL_PLATFORMS`
(for example `substack,linkedin`). It prints one JSON line per post that went out since then:

```
{"kind":"post","platform":"substack","at":"2026-09-28T20:35:25Z","url":"https://...","title":"...","id":"..."}
```

Exit 0 means "this is the record" (nothing printed means no posts); any other exit means it could
not be read. A line with `"kind":"mention"` and `text` plus `at` or `date` adds a mention.
`godspeed-journal check` runs it and says whether it answered. Something that just posted can run
`godspeed-journal evidence` to close the task at once instead of at the next check-in.

## Honest limits

Your mission control cannot see your screen, and it never will; it only knows what you tell it,
in your own words, when you say it. Check-ins and the evening list need your assistant reachable
on a messenger (Chapter 32); without one, entries still save, there is just no nudge. Counted
time only knows what your entries say: a break you took without mentioning it counts as time on
the task, up to four hours, and a task you went back to without saying so counts nothing until
you do.

## What is where

- `bin/`: the `godspeed-journal` command (Node, no dependencies).
- `lib/`: storage, settings, tasks, what is already on record, the check-in and evening timers,
  reports and git sync.
- `skill/interstitial-journal/`: the recipe the setup copies into your mission control.
- `hermes/plugin/godspeed-journal/`: the plugin that shows open tasks before each turn.
- `test/`: network-free tests, `npm test`.

## How it's built

The judgment (recognising an entry, asking for a done definition, checking a finish, deciding how
much to say) lives entirely in the one recipe your assistant reads; everything deterministic
(saving an entry, telling time apart by zone, deciding what's due, keeping settings, committing
to git) lives in the small Node command so it never depends on a model call to work. Two thin
adapters connect the two: the Hermes plugin runs before each turn, and the Hermes tick job (every
fifteen minutes, silent when nothing is due) delivers check-ins and the evening list to Telegram;
a Claude Code hook does the equivalent inside a Claude Code session.

MIT. Use it, change it, share it.
