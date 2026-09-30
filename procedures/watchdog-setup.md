# Watchdog Setup (Chapter 25)

A watchdog is a procedure that checks something for you and speaks up
only when reality changed. You stop checking. It starts.

A watchdog reads the public web and needs almost nothing out of your
folder, so nothing ties it to the computer in front of you. Build it on
your laptop first, so you can watch it work; move it to the machine that
never sleeps (Chapter 32) the day you own one, because on a laptop it
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
   link." Chapter 20 again.
5. **Three outcomes, never two.** Changed; Checked and unchanged; or Not
   checked, naming the sources it could not read. A watchdog that says
   nothing is indistinguishable from a watchdog that broke, and a page it
   could not open is not a quiet week. Silence you can trust has to be
   spoken out loud, and only after the sources were read.

## Worked example (the author's own, run for real 2026-09-02)

First ask your assistant to run this prompt once in your mission control.
Then ask it to schedule the same prompt weekly, in your time zone, under the
name `product watchdog`, with this mission control's full path as the working
folder, delivery kept local, and a check for an existing job before it adds
one:

```
Read AGENTS.md in this working folder and follow it. Check the official Hermes Agent release notes and documentation for changes to the desktop app, scheduled jobs, skills and folder access. Check OpenAI's official ChatGPT pricing and release notes for changes to the subscription route used here. Inspect the named official pages, not just search snippets.

Read watch/product-watchdog.md if it exists. On the first run establish a dated baseline; do not call the current page a newly announced change without evidence of when it changed.

For each source record its URL, check time and whether it was read. Report changes only when they affect what a reader sees, clicks or pays. Explain the practical effect and link the supporting page. Do not repeat an already recorded finding based on the same evidence.

Append a new dated section at the END of watch/product-watchdog.md. Use Changed, Checked and unchanged, or Not checked. If any required source failed, list the failed sources and preserve any partial results. Retry at the next scheduled run; do not create another job. Never replace a failure with a quiet-success line. Send nothing externally and change no account settings.
```

*[Copy prompt](https://querino.ai/prompts/product-watchdog)*

Then read the saved job's time zone, next run, working folder and stop
control. If a source will not open, ask the assistant to find a readable
official alternative that answers the same question, and to show you what
it used.

On Hermes 0.20.6 the first run came back with seven dated findings and
their links (three of them Hermes 0.21.0 release notes, one of them the fact
that writes to `AGENTS.md` and skills are now approval-gated) plus one
line saying no price change was found. Web search needs no key: Hermes
rotates public free tiers of several search vendors.

## Where to put it

- **The job has a folder, on purpose.** The saved working folder is what
  lets it write its weekly section into `watch/product-watchdog.md`, a
  landing place you already walk past; the prompt's first line has it read
  your house rules there.
- **It wants the machine that never sleeps.** Chapter 22's rule bites
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
release notes that is a fair trade. For the machine itself, Chapter 32
adds a check that runs with no AI in it and a test that the repairing
agent can still answer. For a genuinely separate pair of eyes, the
cross-vendor watchdog kit runs a different company's tool as the watcher.

## Boundary: watchdogs and hands

These watchdogs read the public web. Watching *private* things (your
inbox, your bank, your company's systems) needs a **connector**: a door
that lets your assistant reach one of your accounts (Chapter 28's MCP
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

One block in `procedures.md`, including the off-switch (**Pause** on the
job's card, or `hermes cron pause "product watchdog"`). Nothing runs
unlisted.
