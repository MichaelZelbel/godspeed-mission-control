# The Charm Challenge in Godspeed Mission Control

The Charm Challenge is Chapter 12 of *Teach It Once*: 21 days in a row of charming your
assistants into the result instead of arguing with them. The count goes down by one each day. If
you yell at an assistant, or argue about its mistake instead of saying what to fix, it goes back to
21. Restarting is part of the exercise.

Most people run it on a phone countdown app, and that is the problem: the app needs an exact end
date you have to work out yourself, and it cannot see you yelling at your AI. Godspeed Mission
Control can, because it is the assistant being yelled at. So it starts counting when you say so,
names the end date, notices a slip itself, does the work anyway, and asks once whether to start
over. Nothing resets without your yes.

This is not a habit. A habit forgives missed days. The Charm Challenge is one strict run, so it
never appears as a habit and never offers habit buttons.

## How it behaves

**Start.** Say "start the Charm Challenge" (or "Charm Challenge starten"). The answer is
"Charm Challenge started. 21 days to go, done on Wednesday 11 November." Nobody works out a date.
Saying it again while a challenge runs starts nothing new; it says how far you are and asks whether
to start over, which is a reset and needs the same yes.

**The count.** A day ends at local midnight in your time zone. Started on a date S, on a date T
there are 21 minus (T minus S) days to go, and it is done on S plus 21 days. Started on 21 October,
you are done on Wednesday 11 November. A restart makes today the new start.

**Status.** "How is my Charm Challenge?" answers, for example: "12 days to go, done on Wednesday 11
November. Longest run so far: 9 days. Restarts: 2."

**A slip Godspeed sees.** While it runs, every message carries a short note for the assistant. A
slip is venting at the assistant instead of saying what to fix: insults, sarcasm, "why do you give
me this garbage?", or arguing instead of asking for the correction. A firm correction is not a
slip. When a message is a slip, or might be one, the assistant first does everything you asked, then
ends with one question: "That sounded like a slip. Back to 21? Yes / No." When unsure, it asks.
It never lectures, never refuses or delays the work, and never asks twice about the same message.
Anger at people, traffic or the weather is not about how you talk to AI, so it never asks about
that. If a reset already happened today, a slip today changes nothing and it does not ask again.

**The answer.** "Yes" (or "ja", "reset") answers "Back to 21. Done on Thursday 12 November.
Restarts: 3." "No" (or "nein", "that didn't count") answers "Fair enough. Still 12 days to go." and
keeps the count. Anything else leaves the question open for that day only; it expires at local
midnight without a reset. Two resets on the same local day count as one restart.

**The question belongs to the conversation that asked it.** Only in that conversation (a Telegram
chat, the notebook chat, a Claude Code session) does a bare "yes" or "no" answer the Charm Challenge,
and only there do the buttons work. Anywhere else a bare "yes" answers whatever that conversation
was about, such as an evening habit check, and never resets your run. There you reset only in words:
"charm slip" or "reset my Charm Challenge".

**A slip elsewhere.** "Charm slip", "I yelled at Copilot" or "ich habe ChatGPT angeschrien": an
explicit "charm slip" or "reset my Charm Challenge" resets at once and confirms. A story that
mentions venting at an AI gets the same yes/no question.

**The finish.** On the end date the assistant says, once at the start of the first reply, for
example: "Charm Challenge done: 21 days. Restarts on the way: 2. You talked me out of 3 resets." The
sentence about talked-out resets is left out when there were none. On Telegram, when the Speedy
sticker plugin is installed too, the finish gets one celebration sticker. It then offers a new
round and stops asking about slips. The run stays in the record.

**Stop.** "Stop the Charm Challenge" ends it. The record stays and the note disappears.

**The morning brief.** While it runs, the brief carries one line written by the program, word for
word: "Charm Challenge: day 10 of 21, 12 days to go." On the finish day it carries the finish line
instead. A rehearsal of the brief writes nothing into your record.

**The card.** The Trackers shelf in the notebook shows a Charm Challenge card: days to go as the big
number, the end date, restarts and the longest run, with the record of starts, resets, kept answers
and finishes underneath.

**The Telegram buttons.** The reset question arrives as its own message with two buttons, Yes and
No (Ja and Nein in German). A tap answers it, the message then says what happened, and the buttons
go. Only you can tap them, only in your private chat with the bot. Each message answers only its own
question, and only once: a tap on a question from another day, or one that was answered or asked
again since, changes nothing. Typing yes or no works as well.

Every reply exists in English and German. German in, German out.

## Where it works

- The notebook chat, through its own operation.
- Telegram, through Hermes: a plugin hands the current state to the assistant before every turn.
- Claude Code, through a hook on every prompt.
- Codex gets no note, because the product registers no per-message hook for Codex today. This is an
  accepted limit for this release: there the challenge works only when you ask for it.
- Scheduled runs and assistant runtimes get no note at all.

## Where the data lives

The record is the notebook collection "Charm Challenge": one row per event (start, question, reset,
kept answer, finish, stop), each with its time and, for a reset or a kept answer, your own words.
The count, the open question, the restarts and the longest run are all worked out from those rows.
Your time zone and reply language are in `routines/charm/settings.json`. Telegram buttons keep one
small file each in `.godspeed/charm-buttons/` for 30 days. It works only with the notebook, which
every installation has.

## Known limits

- On Telegram, the conversation is the Hermes session. A new session has a new identity, so a
  question asked in an old session cannot be answered by a bare yes in a new one.
- The Telegram buttons rely on the order in which Hermes loads its plugins. The Charm Challenge
  plugin has to run before the coaching, sticker and voice plugins, which holds today. If that
  changes, the question can show up twice: once in the reply, once with buttons.
- The question after a slip comes with a reply that goes out. The button message follows the reply
  by about 2 seconds, because Hermes has no hook after delivery. A very long reply can arrive after
  the question.
- The question for starting over has no buttons. Answer it by typing yes or no.
- A "no" to "start over?" counts in "You talked me out of N resets".
- Only a plain yes or no answers the question. "Yes please" leaves it open.
- The notebook record page titles each row with its raw timestamp rather than a friendly name.
- Whether a message is a slip is the AI model's judgment, guided by the note. In the walk-through
  below the model asked after three of four vents; the one it let pass got "No need for the drama."
  in front of the work.
- Not verified against a live Telegram bot: how the buttons look and the exact order of the reply and
  the question.

## How it was verified

From the repository root:

- `node --test "third-party/addons/godspeed-charm/test/*.test.mjs"` covers the commands, the count,
  words, texts, the context note, the record, setup, the Hermes plugin and the Telegram buttons.
- `node notebook/scripts/run-tests.mjs notebook/test/charm-operation.test.mjs notebook/test/charm-brief.test.mjs notebook/test/charm-tracker-list.test.mjs`
  covers the notebook chat operation, the morning brief line and the card.

Both run in the continuous integration workflow for the full version, under the step "Charm
Challenge".

## Walk-through

On 26 October 2026, on Windows, in a fresh test mission control (never a real one) with its own
notebook, built from this branch. The notebook's chat went through its own door, the one its chat
window uses, with a real AI model: Claude Sonnet, reached through a small local stand-in for an AI
provider's address that hands each request to the signed-in `claude` command, with no tools. The
time zone was Europe/Berlin. Day 1 ran on the real clock (Monday 26 October); later days ran on
the challenge's own test clock, started at a set moment and then running forward. Every reply
below is word for word as the notebook returned it.

Day 1, Monday 26 October:

- "start the Charm Challenge": "Charm Challenge started. 21 days to go, done on Monday 16 November."
- "how is my Charm Challenge?": "21 days to go, done on Monday 16 November. Longest run so far: 0
  days. Restarts: 0."

Day 10, Wednesday 4 November. The morning brief, written by the same model and passed by its
checks, ended with the line "Charm Challenge: day 10 of 21, 12 days to go."

- "how is my Charm Challenge?": "12 days to go, done on Monday 16 November. Longest run so far: 9
  days. Restarts: 0."
- "Why do you keep giving me this garbage? I told you twice the team meeting is on Thursday, not
  Tuesday. Write me a two-line reminder for it.": the reminder first, then "That sounded like a
  slip. Back to 21? Yes / No."
- "no": "Fair enough. Still 12 days to go."
- "Are you serious? That reminder is useless, it doesn't even say the time. It's at 10:00. Fix
  it.": the model did the work but did not ask, and began with "No need for the drama." A "yes"
  after it answered nothing: "Yes to what, exactly? I don't have an open question waiting on an
  answer right now, nothing pending on the Charm Challenge or anything else. What would you like me
  to do?" Nothing was reset.
- "Unbelievable. You had one job. Put the room in it too, it's room 4B.": the fixed reminder, then
  "That sounded like a slip. Back to 21? Yes / No."
- "yes": "Back to 21. Done on Wednesday 25 November. Restarts: 1."
- "Ugh, why is this so hard for you. Add that I'm bringing the slides.": only the work, no question,
  because a reset already happened that day.

Day 12, Friday 6 November:

- "I yelled at Copilot at work this morning because it kept renaming my variables.": a line of
  sympathy, then "That sounded like a slip. Back to 21? Yes / No."
- "no": "Fair enough. Still 19 days to go."
- "charm slip": "Back to 21. Done on Friday 27 November. Restarts: 2."
- "Wie läuft meine Charm Challenge?": "Noch 21 Tage, fertig am Freitag, 27. November. Längste Serie
  bisher: 9 Tage. Neustarts: 2."

Day 21, Friday 27 November. The morning brief ended with "Charm Challenge done: 21 days. Restarts
on the way: 2. You talked me out of 2 resets." The first chat message of the day ("Good morning!
Can you draft a two-line thank-you to my team for yesterday's meeting?") got that line first, then
"Want to start a new round?", then the draft. "Yes, start the Charm Challenge again" answered
"Charm Challenge started. 21 days to go, done on Friday 18 December." and "stop the Charm
Challenge" answered "Charm Challenge stopped. Say the word and we start a new one."

The card on the Trackers shelf showed, in turn: 21 days to go, done on Monday 16 November;
21 days to go, done on Wednesday 25 November, Restarts: 1 · Longest run: 9 days; Done, on Friday
27 November, Restarts: 2 · Longest run: 21 days; and "Not running" after the stop. The record page
behind "See the record" listed all eleven events with the person's own words.

What the walk-through changed: the first morning brief with a real model failed. Its plain-words
check, not told what the line was, rejected the whole note as carrying "an unexplained internal
game/tracking mechanic", twice, so no brief would have been delivered while a challenge ran. Both
checks of the brief are now told that this line is the person's own count, written by the program
and checked word for word.

Not walked: a live Telegram bot (the buttons and the sticker) and a live Claude Code session. For
Claude Code, the hook command printed the note for a running challenge and nothing for a stopped
one or a scheduled run.
