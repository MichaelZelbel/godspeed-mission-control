# Chapter 22: The Morning Brief

The day shouldn't have to begin with a tour of every project you left open yesterday. A morning brief can remind you where things are and bring a little of the next step with it: a reply to review, questions for a meeting or options for a decision. That is a more useful welcome than another list of things you haven't done.

You can build the first brief from your own hub or try it in the fictional folder below. Choose one for now. Robin's bicycle customers don't need to take up residence in your personal profile.

## Optional practice: Robin's bicycle shop

Robin runs a bicycle repair shop and is considering maintenance classes. Three customers have asked about puncture repair. There is no class date, price or booking yet.

Download [the companion kit for this review edition](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once-Companion.zip) and unpack it. Find `practice/maintenance-classes/`. It contains `what-my-ai-knew.md`, `inbox/workshop-notes.md` and instructions. The decision skill is at `skills/prepare-a-decision/SKILL.md` in that same kit.

Ask Hermes to prepare a separate folder. Give it the unpacked kit's actual location when you paste this:

```
Use the unpacked companion kit at the location I give you. Create a new disposable hub named robin-practice beside my real hub. Stop if that folder already exists; do not merge or overwrite it.

Copy starter-hub/ into robin-practice, including its dot files. Copy practice/maintenance-classes/what-my-ai-knew.md into its top level and its workshop-notes.md into inbox/. File the fictional summary under profile/about-me.md, profile/people.md, profile/projects.md and profile/voice.md according to each file's subject, as in Chapter 4. Preserve the summary as the source, keep uncertain claims marked, and retain unresolved questions in inbox/. Proposed behavior rules need confirmation before entering rules/ and the compiled instructions. Do not put anything in my real profile or notebook.

Copy the kit's skills/prepare-a-decision/SKILL.md into robin-practice/skills/prepare-a-decision/SKILL.md. Confirm that the copied skill, profile files and workshop note can be read. Report the full practice path and leave all schedules off.
```

Open the practice folder in Hermes and check that it is the working folder before going on. You'll use the Hermes installation you already have. Only the folder changes.

Copying a folder doesn't automatically make its skills discoverable. To keep this exercise clear, we'll name each skill's exact path so the job can read the file directly.

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

The skill tells the assistant what to do; the dated file in `brief/` is what it produced. The command `hub-check-brief` catches delivery problems, such as telling a phone reader to open a local file. You'll still judge the advice and check the length yourself.

This is part of the brief produced on 7 September 2026 from Robin's fictional shop files:

> Prepared draft : not sent
> “Hi! We are exploring a small bicycle-maintenance class. Would puncture repair interest you? Would you also want brake checks? What days or times generally suit you? This is just an interest check, not a booking. Thanks, Robin.”

It also raised the questions about capacity and insurance that the notes hadn't answered. I'm glad those stayed visible. Three interested customers are a reason to explore a class, not enough information to offer one safely.

Read your first brief and choose one correction that would make tomorrow's more useful. You don't have to perfect it before you let it run again.

## Save the daily job

In the desktop app used for these tests, the controls were **Scheduled jobs**, then **New cron**. “Cron” means a scheduled job here. If your version has different labels, look for the same facts in the saved job. Use these values:

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

The tested app took its working folder from the app's configuration, rather than a field on each job. Ask Hermes to confirm that folder and the scheduler's time zone. After saving, read **Next** and check that it is the day and time you meant. It's much easier to correct a wrong time now than to wonder tomorrow where the brief went.

The prompt explicitly asks the job to read `AGENTS.md` for a reason. In an earlier scheduled test, I asked what instructions it had received without opening files. It answered “NO RULES WERE GIVEN.” I don't want to rely on the folder merely being there; I want the job told to read its rules.

## Test the work and the timer separately

**Trigger now** is useful for trying the saved prompt. But you started that run by pressing a button, so it can't tell you whether the timer works.

Because you already made today's brief, use a separate one-time practice job to test the timer:

```
Create one one-time test, due in 5 minutes, in this folder. Show its saved job record, actual time zone and next run. Its prompt must read AGENTS.md and skills/morning-brief/SKILL.md, then write to practice/brief-tests/timer-test.md as an explicit test output. Refuse to overwrite that file. Use no external delivery. Add the test and its stop control to procedures.md.
```

Leave **Trigger now** alone for this test. Keep the computer awake and Hermes running, then come back after the scheduled time. Look at the run history, open the new practice result and check that the one-time job has no future run. This is the moment to see whether the work begins without you.

If nothing appears, start with the recorded error. A sleeping computer, a missing model connection and a refused tool need different fixes. Rewriting the brief instructions won't wake the laptop.

When I tested shutting down the desktop app, missed slots led to one late run after restart. Your version may behave differently, so don't plan around that result without checking. Opening the lid alone won't repair a model connection or finish an interrupted job.

One run in the test record was due at 19:27 and appeared at 19:27:14. Fourteen seconds wasn't a problem for that brief. It also wasn't a promise of exact timing for every future job, or permission to schedule runs as often as I liked.


## Use the stop control once

Pause the daily job and confirm its state is **Paused**. Resume it when you want the daily schedule active. A displayed next time is not evidence of an active job if its state says paused.

In the tested app, pause stopped scheduled starts but still allowed a manual **Trigger now**. To retire the practice job, remove it through **Manage** after checking its result. Preserve the result file.

Write the daily job's computer, folder, time zone, next run, output and stop control into `procedures.md`. That gives you a place to look later. The schedule itself lives in Hermes, so copying your hub to another computer won't bring the schedule with it.

## Improve it by using it

My own summary got better through small corrections over several weeks: “too long,” or “say that in plain English.” Those were enough to give it direction. The first brief didn't need to be the final version.

Once a month, look at the sections you keep skipping. Remove the background you don't use. Keep urgent unresolved work and failed checks in view, even when you'd rather have a shorter list.

Each run uses the allowance or incurs the charges of your configured model provider. Search tools may charge separately. Choose a frequency that earns its cost; a timer can repeat an unnecessary job very faithfully.

Let the brief earn a place in your morning. Keep the parts that help you act, and use what irritates you as the next correction.
