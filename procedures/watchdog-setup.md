# Watchdog Setup (Chapter 23)

A watchdog is a procedure that checks something for you and speaks up
only when reality changed. You stop checking. It starts.

A watchdog reads the public web and needs almost nothing out of your
folder, so nothing ties it to the computer in front of you. Build it on
your laptop first, so you can watch it work; move it to the machine that
never sleeps (Chapter 28) the day you own one, because on a laptop it
patrols only while Hermes is open.

## The five parts

Keep all five, in any order that reads naturally:

1. **The rhythm.** Daily for volatile things, weekly for slow ones. A
   watchdog patrols on a schedule, it does not stand guard every second.
2. **The watch.** What to look at, said narrowly. One watchdog per
   worry. A watchdog that watches everything sees nothing.
3. **The bar.** What counts as news ("only changes that alter what a
   user sees, clicks or pays", "only if the price drops below X").
   Without a bar, every patrol finds *something* and you have built a
   spam machine.
4. **The receipt.** "Tell me what changed and where you read it, with a
   link." Chapter 24 arriving early.
5. **The quiet line.** "If you find nothing solid, write exactly one
   line: 'All quiet, nothing changed.' Never pad a quiet week." A
   watchdog that says nothing is indistinguishable from a watchdog that
   broke. Silence you can trust has to be spoken out loud.

## Worked example (the author's own, run for real 2026-09-02)

One line, weekly on Monday at nine, your mission control as the working folder:

```
hermes cron create "0 9 * * 1" "Run my product watchdog. Search the web for changes announced in the last seven days to Hermes Agent: its desktop app, its scheduled jobs, its skills, or how it gets access to a folder. Also check for changes to what a ChatGPT subscription costs or includes. Only report changes that alter what a user sees, clicks or pays. For each change, tell me what changed and where you read it, with a link. Append the result to watch/product-watchdog.md, newest at the top, with the date on it. If you find nothing solid, write exactly one line: \"All quiet, nothing changed.\" Never pad a quiet week." --name product-watchdog --workdir /path/to/your/godspeed
```

Then `hermes cron run product-watchdog` to see it work once, right now. On
Hermes 0.20.6 the first run came back with seven dated findings and their
links (three of them Hermes 0.21.0 release notes, one of them the fact
that writes to `AGENTS.md` and skills are now approval-gated) plus one
line saying no price change was found. Web search needs no key: Hermes
rotates public free tiers of several search vendors.

## Where to put it

- **The job has a folder, on purpose.** `--workdir` your mission control is what lets
  it write its weekly line into `watch/product-watchdog.md`, a landing
  place you already walk past, and what hands the job your house rules.
- **It wants the machine that never sleeps.** Chapter 21's rule bites
  hardest here: on a laptop it patrols only while Hermes is open, and a
  missed Monday runs once, late, when you next open it.
- **A hand run proves the job, not the clock.** `hermes cron run` works
  with the gateway stopped and records `source=direct`; a run the clock
  fired records `source=builtin`.

## Ideas to steal (public web, no special access needed)

- A product you want back in stock, or below a price you name.
- Announcements from your town, or a school's public calendar.
- A software release or feature change that affects how you work.
- Tour dates, ticket sales, a festival lineup.
- Mentions of your name, your business, or your product.
- The commands and screens of the AI tool you depend on. They get
  renamed, and so do the plans you pay for.

## The honest paragraph

A watchdog that shares a program, a subscription and a machine with the
thing it watches cannot see every failure: if Hermes will not start, the
job that would have told you does not start either. For a weekly look at
release notes that is a fair trade. For the machine itself, Chapter 28
adds a check that runs with no AI in it and a test that the repairing
agent can still answer. For a genuinely separate pair of eyes, the
cross-vendor watchdog kit runs a different company's tool as the watcher.

## Boundary: watchdogs and hands

These watchdogs read the public web. Watching *private* things (your
inbox, your bank, your company's systems) needs a **connector**: a door
that lets your assistant reach one of your accounts (Chapter 26's MCP
servers are the Hermes shape of that door).

A connector is not a bigger version of chatting. It is hands. Before you
open one, have the red lines from Chapter 17 in your `AGENTS.md`, and
know that they work harder for procedures than for chats, because a chat
has you in the room.

Two layers, and you want both:

1. **Permissions.** Connect only accounts you actually use. Take
   read-only when it is offered. No stored payment method, ever.
2. **The red lines.** They catch what permissions cannot: the Tuesday
   you type "just do it, I trust you" because you are tired.

## Then the paperwork

One block in `procedures.md`, including the off-switch (`hermes cron pause
product-watchdog`). Nothing runs unlisted.
