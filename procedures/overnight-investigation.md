# Chapter 23: Let AI Investigate a Question While You Are Away

Some questions deserve more than a line in the morning brief. You need a comparison, perhaps a draft message, and a little time to think before committing. An investigation can prepare that material while you're away, so you return to a decision with some of the reading already done.

We'll use Robin's separate practice hub again. He is the fictional bicycle-shop owner considering maintenance classes. You can choose a real question instead, provided the hub can reach the sources it needs.

## Check the starting material

In the practice hub, ask:

```
Confirm that this is robin-practice. Read AGENTS.md, profile/, inbox/workshop-notes.md and skills/prepare-a-decision/SKILL.md. Confirm the profile says Robin runs a bicycle repair shop. List any missing file. Create no job until these inputs are available.
```

If you skipped Robin's setup in Chapter 22, make that separate folder first. His files are practice material, so keep them out of your real notebook.

The question is ordinary:

```
What should I do next about the maintenance classes?
```

That is a perfectly reasonable question to ask another person. For a job that starts later, we'll also save where to read, what to produce and when to stop. Once those details are in the setup, you won't have to hover nearby supplying them.

## Save one run

Paste this in the practice folder:

```
Create a one-time investigation named robin-maintenance-once, due in 5 minutes. Use this practice folder as its working folder. Confirm the scheduler's named time zone and show the resolved next-run time. Do not use a repeating interval and do not trigger it manually.

Save this job prompt:
Read AGENTS.md and skills/prepare-a-decision/SKILL.md. Answer: What should Robin do next about the maintenance classes? Read profile/, what-my-ai-knew.md and inbox/workshop-notes.md. Use only those sources. Compare plausible options, distinguish evidence from assumptions, and identify gaps that could change the recommendation. Prepare an unsent customer interest message and questions about capacity and insurance. Do not invent a date, price, booking or external check. Write a new file at investigations/robin-maintenance-once.md; refuse to overwrite it. If a source is missing, record that failure and limit the answer accordingly. Send nothing, buy nothing and stop after writing the result.

Show the saved job record with its one-time schedule, working folder, time zone, output path and stop control. Record it in procedures.md as a practice job.
```

Look at the saved job before walking away. It should name `robin-maintenance-once`, one future run in the displayed time zone, your actual practice folder and the output `investigations/robin-maintenance-once.md`. “I'll do that” sounds agreeable, but it isn't the record you're looking for.

Keep Hermes running through the scheduled time, then check the result without starting it manually. If your version can't create the job from the request, read the scheduling error and use the app's one-time control. Don't replace it with a daily job; Robin doesn't need the same question investigated every morning.

## Read the prepared work

In an earlier practice run with a short delay, the job prepared this customer draft:

> "Hi! We are exploring a small bicycle-maintenance class at the shop. Would learning puncture repair interest you? We could also cover brake checks, let us know if you'd want that too. What days or times generally suit you? This is just an interest check, not a booking. Thanks, Robin."

The full result kept facts and assumptions apart and compared testing interest with waiting. Three enquiries remained three enquiries. They hadn't become bookings merely because bookings would make the recommendation easier.

Robin still had to resolve the capacity and insurance questions. The instructions above ask the assistant to prepare those questions for him. If you have a relevant document, let the job read it too; there is no need to hand the reading back to you when the source is available.

Read the result as something you might actually use. Can you find its sources, follow its recommendation and see what remains uncertain? Is there prepared text worth keeping? Then check the run history: the timer should have started the job, and the job should have no further run.

My recorded practice run used a short delay, so I can't call it an overnight test. To leave yours until tomorrow, make sure the computer, scheduler and model access will still be available at the scheduled time. The question can wait; the machine has to be there when it comes due.

## Try a missing source

Now make a second copy of the practice hub without the workshop note. Use a new one-time job and another output name. The answer should tell you the note is missing. If it repeats the old customer counts from the conversation, it mustn't present them as facts it has just checked in a file.

After reading both results, stop or retire the practice jobs and keep their output. The limited answer is useful too: it shows what the job does when it can't find something, which is usually when you most need it to be clear.
