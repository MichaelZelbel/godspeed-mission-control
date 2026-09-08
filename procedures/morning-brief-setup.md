# Chapter 22: The Morning Brief

A morning brief should save you from opening every project to remember where you left it. It should also prepare something useful: a reply, questions for a meeting or options for a decision.

Start with your own hub, or use the fictional practice folder below. Choose one for this exercise. Mixing fictional customers into your own profile would make later answers less useful.

## Optional practice: Robin's bicycle shop

Robin runs a bicycle repair shop and is considering maintenance classes. Three customers have asked about puncture repair. There is no class date, price or booking yet.

Download [the companion kit for this review edition](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once-Companion.zip) and unpack it. Find `practice/maintenance-classes/`. It contains `what-my-ai-knew.md`, `inbox/workshop-notes.md` and instructions. The decision skill is at `skills/prepare-a-decision/SKILL.md` in that same kit.

Ask Hermes to prepare a separate folder. Give it the unpacked kit's actual location when you paste this:

```
Use the unpacked companion kit at the location I give you. Create a new disposable hub named robin-practice beside my real hub. Stop if that folder already exists; do not merge or overwrite it.

Copy starter-hub/ into robin-practice, including its dot files. Copy practice/maintenance-classes/what-my-ai-knew.md into its top level and its workshop-notes.md into inbox/. File the fictional summary under profile/about-me.md, profile/people.md, profile/projects.md and profile/voice.md according to each file's subject, as in Chapter 4. Preserve the summary as the source, keep uncertain claims marked, and retain unresolved questions in inbox/. Proposed behavior rules need confirmation before entering rules/ and the compiled instructions. Do not put anything in my real profile or notebook.

Copy the kit's skills/prepare-a-decision/SKILL.md into robin-practice/skills/prepare-a-decision/SKILL.md. Confirm that the copied skill, profile files and workshop note can be read. Report the full practice path and leave all schedules off.
```

Open that folder in Hermes and confirm its working folder before continuing. This uses the Hermes installation you already have. It does not install a second copy of Hermes.

The folder copy alone does not establish automatic skill discovery. These exercises name each skill by its exact path so the job can read it directly.

## Build the brief before its schedule

Paste this in the folder you chose:

```
Build skills/morning-brief/SKILL.md with these instructions, then run it once.

Read AGENTS.md, the profile, current work files, decisions and inbox. Read the previous brief if there is one. Use the current date in the selected job time zone. Do not invent change over time when there is no earlier record.

Write what changed, useful work you prepared, and the decision that needs me. Separate recorded claims from your recommendations. Include a short draft or question set when the sources support one. Name important gaps and failed checks. Send nothing, buy nothing and make no commitments.

Save a new file as brief/YYYY-MM-DD.md. If it already exists, preserve it and report that no second daily brief was written. For an explicit test, accept a separate practice output path and never use or overwrite today's real brief.

Keep the normal brief body under 200 words. Include copyable action text in the brief itself. Use existing approved HTTPS links for longer material only when available; do not publish private material to make a link. File provenance may appear on Sources: lines.

Later additions may put full deadline output, unresolved urgent research and failed-check notices after the normal body. Those required sections are exempt from the 200-word limit. Never cut them to pass the limit. Omit empty optional sections.

Run hub-check-brief on the completed file, fix delivery-format failures and preserve important content. A passed format check is not an evidence check. If checking fails, report the failure and keep the draft available for inspection.
```

The skill is the instruction file. The dated file in `brief/` is its result. `hub-check-brief` checks for delivery problems such as asking a phone reader to open a local file. It does not judge the advice or enforce the word limit.

Here is an exact excerpt from the 7 September 2026 run against Robin's fictional shop files:

> Prepared draft : not sent
> “Hi! We are exploring a small bicycle-maintenance class. Would puncture repair interest you? Would you also want brake checks? What days or times generally suit you? This is just an interest check, not a booking. Thanks, Robin.”

The result also named the unanswered capacity and insurance questions. Those gaps matter. Customer interest does not prove that a class can safely be offered.

Read your first result. Correct one thing that would make it more useful before scheduling it.

## Save the daily job

In the tested desktop app, open **Scheduled jobs**, select **New cron** and enter these values. “Cron” is the app's word for a scheduled job. Labels may change; the saved job must still show these same facts.

| Field | Value |
|---|---|
| Name | `morning brief` |
| Frequency | Custom: `every day at 7am` |
| Delivery | This desktop |
| Working folder | Your chosen hub, confirmed before saving |
| Time zone | Your local named zone, for example `Europe/Berlin` |

Use this job prompt:

```
Read AGENTS.md in the working folder and follow it. Read skills/morning-brief/SKILL.md and write today's brief to brief/ using that skill. Preserve any existing daily brief. Report unavailable inputs or failed checks. Do not send anything externally.
```

The desktop version tested used its configured folder rather than a folder field on each job. Ask Hermes to confirm that folder and the scheduler's time zone. Read **Next** after saving. It must show the day and time you intended. Edit the job if it does not.

Explicitly reading `AGENTS.md` matters. An earlier scheduled test answered “NO RULES WERE GIVEN” when asked what instructions it had received without opening files. Do not assume the folder's existence proves the job read its rules.

## Test the work and the timer separately

**Trigger now** starts work because you pressed a button. It can test the saved prompt, but it does not prove the timer fired.

Because you already made today's brief, use a separate one-time practice job to test the timer:

```
Create one one-time test, due in 5 minutes, in this folder. Show its saved job record, actual time zone and next run. Its prompt must read AGENTS.md and skills/morning-brief/SKILL.md, then write to practice/brief-tests/timer-test.md as an explicit test output. Refuse to overwrite that file. Use no external delivery. Add the test and its stop control to procedures.md.
```

Do not press **Trigger now**. Leave the computer awake and Hermes running through the slot. Afterwards inspect the run history and open the new practice result. Confirm the one-time job has no future run.

If the file is missing, read the error. A missing model connection, a refused tool or a sleeping computer needs a different repair from a bad instruction.

In my earlier desktop shutdown test, missed slots produced one late run after restart. That is historical behavior from the tested app, not a guarantee for every version. Opening a laptop lid alone does not restore model access or finish a job.

The test record included a run due at 19:27 and recorded at 19:27:14. That shows a small delay for one run. It does not promise exact timing or unlimited frequency.


## Use the stop control once

Pause the daily job and confirm its state is **Paused**. Resume it when you want the daily schedule active. A displayed next time is not evidence of an active job if its state says paused.

In the tested app, pause stopped scheduled starts but still allowed a manual **Trigger now**. To retire the practice job, remove it through **Manage** after checking its result. Preserve the result file.

Update `procedures.md` with the daily job's computer, folder, time zone, next run, output and stop control. Schedules live in Hermes, so copying the hub later does not move them automatically.

## Improve it by using it

My own daily summary improved through short corrections over several weeks: “too long,” or “say that in plain English.” A useful brief can start imperfectly.

Once a month, review sections you regularly skip. Remove unhelpful background. Keep unresolved urgent work and failed checks visible until they are resolved.

Scheduled runs consume the model allowance or usage charges of the configured provider. Extra search tools can have their own charges. The timer itself does not make the work free.

Next, give one question a one-time schedule and return to a prepared answer.
