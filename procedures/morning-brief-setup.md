# Chapter 21: The Morning Brief

Before the day gets busy, you'd like to know where things are. You could open every project and remind yourself what you left unfinished. Or the assistant could prepare a short brief with some useful work already attached: a reply to read, meeting questions, or a choice laid out clearly. I want that second kind of morning. I already know how to make myself a longer task list.

Build the first brief from your own mission control if it already contains useful project notes. If you'd rather see the method with prepared material, use the fictional bicycle shop below. It has a separate practice folder, so Robin's customers won't become part of your personal profile.

## Optional practice: Robin's bicycle shop

Robin runs a bicycle repair shop and is considering maintenance classes. Three customers have asked about puncture repair. There is no class date, price or booking yet.

Use the matching companion kit you unpacked during setup, or [download it here](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once-Companion.zip). It includes Robin's briefing and workshop notes under `practice/maintenance-classes/`, plus a skill for preparing decisions. The assistant can copy these into a separate practice godspeed.

Ask the assistant to prepare the folder:

```
Find the matching unpacked companion kit, asking where I saved it only if needed. Create a new disposable mission control named robin-practice beside my real mission control. Stop if that folder already exists; do not merge or overwrite it.

Copy starter-godspeed/ into robin-practice, including its dot files. Copy practice/maintenance-classes/what-my-ai-knew.md into its top level and its workshop-notes.md into inbox/. File the fictional summary under profile/about-me.md, profile/people.md, profile/projects.md and profile/voice.md according to each file's subject. Preserve the summary as the source, keep uncertain claims marked, and retain unresolved questions in inbox/. Proposed behavior rules need confirmation before entering rules/ and the compiled instructions. Do not put anything in my real profile or notebook.

Copy the kit's skills/prepare-a-decision/SKILL.md into robin-practice/skills/prepare-a-decision/SKILL.md. Confirm that the copied skill, profile files and workshop note can be read. Report the full practice path and leave all schedules off.
```

Open the practice folder in your assistant and check that it is the working folder. You'll use the installation you already have; changing the folder gives this exercise its own files.

The saved job instructions name each skill file. This lets the practice job read the copied method even if Hermes has not added the new folder to its skill search.

## Build the brief before its schedule

In the folder you chose, tell the assistant the time zone to use, such as Europe/London. Then ask for a skill and its first brief. Reading one actual result will tell you far more about the instructions than polishing them in advance:

```
Build skills/morning-brief/SKILL.md with these instructions, then run it once.

Read AGENTS.md, the profile, current work files, decisions and inbox. Read the previous brief if there is one. Use the current date in the selected job time zone. Do not invent change over time when there is no earlier record.

Write what changed, useful work you prepared, and the decision that needs me. Separate recorded claims from your recommendations. Include a short draft or question set when the sources support one. Name important gaps and failed checks. Send nothing, buy nothing and make no commitments.

Save a new file as brief/YYYY-MM-DD.md. If it already exists, preserve it and report that no second daily brief was written. For an explicit test, accept a separate practice output path and never use or overwrite today's real brief.

Keep the normal brief body under 200 words. Include copyable action text in the brief itself. Use existing approved HTTPS links for longer material only when available; do not publish private material to make a link. The file a fact came from may be named on a Sources: line.

Keep urgent unfinished work and failed-check notices visible after the normal body when they need more space. These sections are exempt from the 200-word limit. Never cut them to pass the limit. Omit empty sections.

Run mc-check-brief on the completed file, fix delivery-format failures and preserve important content. A passed format check is not an evidence check. If checking fails, report the failure and keep the draft available for inspection.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-21-text-2-20260913)*

Open the dated file in `brief/` to see the result. The skill file contains the method that produced it. `mc-check-brief` looks for delivery problems, such as asking a phone reader to open a file on a computer. It can't decide whether the advice was worth reading; that's what you're checking now.

This is part of the brief produced on 7 September 2026 from Robin's fictional shop files:

> Prepared draft : not sent
> “Hi! We are exploring a small bicycle-maintenance class. Would puncture repair interest you? Would you also want brake checks? What days or times generally suit you? This is just an interest check, not a booking. Thanks, Robin.”

The brief also kept the unanswered questions about capacity and insurance visible. Three people had shown interest, which gave Robin a reason to investigate. It hadn't given him a class to sell. I liked that the draft helped him take the next step without quietly skipping those questions.

Read the first brief as if it had arrived tomorrow morning. Where would you slow down, or have to ask what a sentence meant? Tell the assistant which parts need correcting, then read the revised brief. Once it is useful as a whole, ask it to save the changes in the skill.

## Save the daily job

Once the brief is useful, ask the assistant to give it a daily start time. Scheduling is a tool the assistant can use; you do not need to translate seven in the morning into a scheduling expression.

```
Set up a daily morning brief at 7am in the time zone we agreed. Inspect existing jobs first. If a morning brief already exists for this mission control, show it and update that job rather than creating a duplicate.

Use this mission control's full path as the job's working folder. Save this job prompt:
Read AGENTS.md in the working folder and follow it. Read skills/morning-brief/SKILL.md and write today's brief to brief/ using that skill. Preserve any existing daily brief. Report unavailable inputs or failed checks. Do not send anything externally.

Keep delivery local. Confirm that the scheduler is running on this computer; a saved job alone is not enough. If it needs setup, explain what must run and configure it within my existing permissions. Do not change other jobs or a shared time-zone setting silently.

Show the saved job's working folder, time zone, next run, result location and pause control. Record these in procedures.md. If any part cannot be checked, say which part and do not describe the schedule as ready.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-21-text-3-20260913)*

The working folder is the directory where that later job will read and write. Hermes now supports saving it with each job. Without it, a scheduled run may start outside your mission control even though the conversation was inside it. This behaviour is described in the [official scheduling guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron/).

Read the saved record. Check that it names your chosen mission control and the intended time zone. Seven in the morning is useful only after you agree which seven. In the desktop app, **Scheduled jobs** shows the saved jobs; **Next** is the next start time. Some controls use the word **cron**, which means a scheduled job here.

On Linux without the desktop app, the Hermes gateway can run the scheduler. A gateway is a background Hermes process, also used for messaging connections. Ask the assistant to configure and check that process. If your operating system asks for administrator approval, complete that step yourself and let the assistant continue.

I put the instruction to read `AGENTS.md` at the front of the job because an earlier scheduled test missed the rules. Asked what it had received without opening files, it answered "NO RULES WERE GIVEN." The folder was there, complete with instructions. Apparently I still needed to suggest reading them.

## Test the work and the timer separately

Pressing **Trigger now** runs the saved prompt on request, so you can inspect what the job produces. It doesn't test the timer: you supplied the start. Letting a scheduled time pass with Hermes running tests the other half.

To test the timer without touching today's brief, use a separate one-time practice job:

```
Create one one-time test, due in 5 minutes, with this mission control's full path saved as its working folder. Show its saved job record, actual time zone and next run. Its prompt must read AGENTS.md and skills/morning-brief/SKILL.md, then write to practice/brief-tests/timer-test.md as an explicit test output. Refuse to overwrite that file. Use no external delivery. Add the test and its stop control to procedures.md.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-21-text-4-20260913)*

Keep the computer awake and the scheduler running, and let the timer start this test without pressing **Trigger now**. Return after the scheduled time and ask the assistant to check the run history, new practice result and absence of a future run. Read the result itself. That checks both the automatic start and the work it produced.

If nothing appears, ask the assistant to diagnose the missed run. A sleeping laptop, a missing model connection and a refused tool each call for a different repair, even when they leave the same empty output folder.

When I shut down the desktop app in a test, missed slots became one late run after restart. A missed morning brief may therefore arrive late. Read the run history to see whether that happened before rewriting the skill.

One test run was due at 19:27 and appeared at 19:27:14. For a morning brief, I can live with fourteen seconds.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

## Use the stop control once

Pause the daily job and look for **Paused**. The app can still display a next-run time, which makes a stopped job look surprisingly punctual, but **Paused** takes priority. Resume it when you want the daily schedule active.

In the tested app, pause stopped scheduled starts but still allowed a manual **Trigger now**. To remove the practice job, delete it through **Manage** after checking its result. Preserve the result file.

Have the assistant keep the daily job's computer, folder, time zone, next run, output and stop control in `procedures.md`. This becomes your reference when you change machines. The schedule itself lives in Hermes, so copying Mission Control files to another computer won't carry the schedule with them.

## Improve it by using it

My brief was rough for weeks. Most mornings, an ordinary correction such as "too long" or "say that in plain English" gave me something specific to improve. I learned what belonged in it by using it, which saved me from designing an elaborate brief I would then avoid reading.

Reports have a habit of growing one helpful section at a time until half the helpful sections get skipped. Once a month, notice which ones you pass over. Cut background that no longer changes a decision, while keeping urgent unfinished work and failed checks visible even when they make the brief longer.

Each run uses your model allowance or adds to its usage bill. Search tools may charge separately. Choose a pace that earns the cost. A timer will repeat an unnecessary job with the same care as a useful one.

Give the brief a few mornings, then revise the parts you find yourself correcting or skipping. Keep the useful drafts and the explanations that help you make a choice. You are teaching it the shape of a morning you actually have.
