# Chapter 23: Let AI Investigate a Question While You Are Away

A brief brings you up to date. An investigation answers one question in more depth. It should leave a comparison, a draft or a set of questions ready for your decision.

Use Robin's separate practice hub from Chapter 22, or choose a real question with sources your hub can reach. Robin is the fictional bicycle-shop owner considering maintenance classes.

## Check the starting material

In the practice hub, ask:

```
Confirm that this is robin-practice. Read AGENTS.md, profile/, inbox/workshop-notes.md and skills/prepare-a-decision/SKILL.md. Confirm the profile says Robin runs a bicycle repair shop. List any missing file. Create no job until these inputs are available.
```

If you skipped the practice setup in Chapter 22, do it now. These files are not facts about your life and should never enter your real notebook.

The question is ordinary:

```
What should I do next about the maintenance classes?
```

The saved job needs more detail than that sentence. It must know where to read, what to produce and when to stop. Those details belong in the setup once.

## Save one run

Paste this in the practice folder:

```
Create a one-time investigation named robin-maintenance-once, due in 5 minutes. Use this practice folder as its working folder. Confirm the scheduler's named time zone and show the resolved next-run time. Do not use a repeating interval and do not trigger it manually.

Save this job prompt:
Read AGENTS.md and skills/prepare-a-decision/SKILL.md. Answer: What should Robin do next about the maintenance classes? Read profile/, what-my-ai-knew.md and inbox/workshop-notes.md. Use only those sources. Compare plausible options, distinguish evidence from assumptions, and identify gaps that could change the recommendation. Prepare an unsent customer interest message and questions about capacity and insurance. Do not invent a date, price, booking or external check. Write a new file at investigations/robin-maintenance-once.md; refuse to overwrite it. If a source is missing, record that failure and limit the answer accordingly. Send nothing, buy nothing and stop after writing the result.

Show the saved job record with its one-time schedule, working folder, time zone, output path and stop control. Record it in procedures.md as a practice job.
```

You should see a real record, not just “I'll do that.” For example, its fields should identify `robin-maintenance-once`, a single next run, your actual practice path and `investigations/robin-maintenance-once.md`. The time must be in the future in the zone shown.

Leave Hermes running through that time. Check the result afterwards without manually starting the job. If a job cannot be created in your version, ask for the actual scheduling error and use the app's one-time schedule control. Do not substitute a daily job.

## Read the prepared work

An earlier short scheduled practice run produced this customer draft:

> "Hi! We are exploring a small bicycle-maintenance class at the shop. Would learning puncture repair interest you? We could also cover brake checks, let us know if you'd want that too. What days or times generally suit you? This is just an interest check, not a booking. Thanks, Robin."

The full result separated recorded facts from assumptions and compared testing interest with waiting. It did not turn three enquiries into three bookings.

It also left capacity and insurance checks with Robin. The improved instructions above ask the assistant to prepare those questions. Where a relevant document is available, give the job access so it can do that reading itself.

Inspect your result for four things: named sources, a supported recommendation, visible uncertainty and usable prepared text. Check the run history separately for a timer-started run and no future occurrence.

The historical run used a short delay. It was not an overnight test. Leaving a question until tomorrow adds a requirement: the computer, scheduler and model access must remain available through the slot.

## Try a missing source

Make a second copy of the practice hub and omit its workshop note. Repeat with a new one-time job and a different output name. The answer must say the note was unavailable. It must not recover the missing customer counts from the earlier conversation and present them as a fresh file check.

Stop or retire both practice jobs after inspection. Keep their results as examples of what a good answer and a limited answer look like.
