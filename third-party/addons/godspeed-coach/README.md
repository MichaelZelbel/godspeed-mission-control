# godspeed-coach: a coach that opens the conversation

**Pick an area of your life, a day and a time. Your mission control opens the talk on your
messenger, remembers the last one, and helps you decide one thing. Habits you track in one
spoken line.** An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control) from
[*Teach It Once*](https://leanpub.com/teachitonce).

> Sunday, 19:00. "From your coach, your weekly health talk: on Monday you said washing up often
> leaves you tired. When it happens: how often, how long, and does it come with any dizziness?"

> Track head lifts.

> 21:00. "From your coach: Face-down head lifts today? You planned this habit for every day, and
> nothing is tracked for today yet. Reply "yes" if you did it, "no" if you didn't, or "skip" if
> today shouldn't count, for example because you were ill. No reply is fine: the day stays blank
> and I won't ask about it again." Only when you have not said it yet.

## Why it exists

A weekly conversation about your health, your work or the people in your life does more than
any dashboard, but only if it happens. So the coach starts it, at the time you picked, and keeps
it short: one thing it noticed, one question. The rest is a conversation. What you decide is
written down, so next week starts where this one ended.

Habits are the other half. A talk decides on a small habit; you say "track head lifts" when you
did it; the evening check asks only about what you have not mentioned, and on a good day you hear
nothing. After six weeks of mostly done, the talk offers to graduate the habit. Two weeks under
half, it asks whether to make it smaller or drop it. A day you answer "skip" counts neither way: it
is left out, as if the habit had not been planned that day.

A habit belongs to one area, and only that area's talk offers to graduate it or make it smaller.
Other talks may look at it too: your walk to work can matter to a health talk and to a psychology
talk alike. So that two talks do not go over the same thing every week, a talk never opens with
something another talk raised in the last seven days.

## What it is

- **One folder per area** under `coach/` in your mission control: `area.md` (rhythm, time,
  style, tone, limits, how to prepare), `questions.md`, `talks/` (one record per talk) and
  `habits/` (one file per habit). Plain text you can read and edit.
- **One command**, `godspeed-coach`, that the recipe and the schedule use.
- **One recipe**, `coach`, copied into your skills folder: how to open, continue and close a talk,
  how to track a habit, and what never to do (a wall of text, praise, a habit you did not agree to).
- **Two scheduled jobs in Hermes**, however many areas you have. `coach-talks` checks every 15
  minutes whether a talk is due and starts the model only then. `coach-tick` sends the evening
  habit check and one follow-up for an unanswered talk, and never uses a model. A mission control
  set up from the notebook's first goal has the same two under the names "Weekly check-in" and
  "Coach reminders and habit check".
- **A Hermes plugin and a Claude Code hook** that show the open talk and tonight's habit question
  before every turn, so your answer lands in the right place wherever you type it. An open talk
  comes with its opening and what was prepared for it, so it goes on without looking anything up.
- **Your goal research, when there is some.** If your mission control keeps research next to a
  goal the area serves (`goals/research/<goal>/brief.md`), the talk's brief carries what it found,
  and the talk starts from that instead of from a to-do list.
- **A talk prepared ahead, when a job of yours writes one.** A minute before a talk is too little
  time to prepare it well. If something writes `coach/<area>/prep/<talk date>.md` ahead of time
  (`STATE: ready`, a section "The opening" and a section "Talk card"), the talk opens with that
  opening as written, and every interface carries its talk card while the talk is open, with the
  file behind it for depth. `godspeed-coach prep-due` tells that job which coming talks still need it,
  and which were prepared more than 48 hours before they start and need it again;
  `godspeed-coach prep-check` says whether one talk's file is ready. In Godspeed Mission Control the
  routine "Coaching talk preparation" is that job: every night it prepares each talk of the next day
  with the coach-prep recipe.

## Install

Godspeed Mission Control brings this add-on with it: its installers put the `godspeed-coach`
command next to its other commands, copy the recipe into your skills folder and wire the Hermes
plugin and the two scheduled jobs. There is nothing more to install.

To add it to a mission control folder of your own by hand, run its setup from a copy of Godspeed
Mission Control, as the account your assistant runs as:

```
git clone --depth 1 https://github.com/MichaelZelbel/godspeed-mission-control.git
node godspeed-mission-control/third-party/addons/godspeed-coach/bin/godspeed-coach.mjs setup --godspeed <your mission control folder>
```

> Assistant: run that setup line with `--godspeed <this mission control folder>` and pass its
> questions to the person.

Any folder that holds this add-on, the one this README is in, works the same way: run
`node bin/godspeed-coach.mjs setup --godspeed <your mission control folder>` inside it, and it
installs the copy that folder holds. You need Node.js 22 or newer; the one Hermes brings along
will do.

On Windows, setup also writes a PowerShell launcher next to the command, so a talk's opening and
your words reach the coach exactly as given, line breaks, quotes and umlauts included. cmd.exe
cannot carry a line break (it stops reading at the first one and drops the rest), so a command
that reaches the coach cut short through it is refused, never half saved. Where PowerShell is set
to run no scripts at all, setup says so and leaves that launcher out; text that runs over several
lines then goes in with `--words-file` or `--opening-file`.

Then ask your assistant for your first area: "I want a weekly health talk on Sundays at seven."

## Use

```
godspeed-coach areas                          # the areas and when each next talks
godspeed-coach brief health                   # what the next health talk would start from
godspeed-coach area read health "my running app"                   # what the talk may look at
godspeed-coach area limit health "never suggest buying anything"   # what it must never do
godspeed-coach area read health "my running app" --remove          # --remove takes one back
godspeed-coach habit add health head-lifts --title "Face-down head lifts" --done-means "a few 10-second holds" --days daily
                                              # an area that does not exist yet is made, with no talk
godspeed-coach habit track "did head lifts"   # --answer no|skip, --date yesterday
godspeed-coach habit answer yes no            # tonight's check, in the order it asked
godspeed-coach habit list                     # --all for paused and graduated ones too
godspeed-coach habit read-by "walk to work" psychology            # another talk may look at it too
godspeed-coach habit read-by "walk to work" psychology --remove   # --remove takes it back
godspeed-coach habits week                    # the last seven days of each habit
godspeed-coach talk state health              # the last five health talks and how they went
godspeed-coach talk said health --words "first message" --words "second message"   # one --words per message
godspeed-coach prep-due --within-hours 48     # the coming talks with no prepared talk yet (--json too)
godspeed-coach prep-check health --date 2026-10-18   # is that talk's preparation ready? (--json too)
godspeed-coach talk open health --from-prep coach/health/prep/2026-10-18.md   # open from a prepared talk
godspeed-coach config show                    # time zone, language, habit check time, cap

# words or an opening that run over several lines, from any shell: put them in a file first
godspeed-coach talk said health --words-file words.txt
godspeed-coach talk open health --opening-file opening.txt --prepared-file prepared.txt --read "the week's runs"
```

## Honest limits

- Without a messenger, a talk still opens at its time and waits in your chat: your assistant
  brings it up the next time you write to it. With a messenger it comes to your phone.
- The coach never diagnoses, never tells you to see a doctor, never buys, books, pays or contacts
  anyone for you. Each area can add its own limits.
- Five active habits at most, by design. More than that is a list, not a habit.
- Changes reach your other computers through your mission control's git history. One that cannot
  be committed or pushed straight away waits in git's own folder and goes out with the next save,
  or the next round on the computer that sends the talks. `git_sync` (auto, commit or off) works
  per mission control folder in effect: one push sends every local commit, so commit-only changes
  go out with the next push of an add-on set to auto.

## For the maintainer

This repository is where the add-on is developed, and it is private, so the line below works
only with access to it. Godspeed Mission Control carries a copy at
`third-party/addons/godspeed-coach/`, and changes go both ways between the two.

```
npx --yes github:MichaelZelbel/godspeed-coach setup --godspeed <your mission control folder>
```

Tests: `npm test`, and `npm run test:hermes` for the Hermes plugin (Python 3).

Areas can require verified preparation by adding repeated `RESEARCH DOMAIN: id | scope` header
lines to `area.md`. Those preparations need `<date>.evidence.json` and `<date>.review.json`
beside the Markdown file. The preparation runner collects successful source-page reads from the
actual execution transcript, then runs a separate reviewer for every configured domain. The
runtime checks both receipts against the exact preparation and area file hashes before a brief
or `talk open --from-prep` may use it. Changing the preparation, its evidence, or the area's scope
invalidates the review. Search snippets alone and the writer's `STATE: ready` cannot pass.
Areas without research domains retain the earlier preparation behavior. Future preparation
timestamps are refused for every area, with one minute allowed for clock differences.
