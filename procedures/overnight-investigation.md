# Chapter 22: Let AI Investigate a Question While You Are Away

Some decisions occupy your mind long before they get a place in your calendar. You know the next step is to read the material, compare the choices or draft a question, but the preparation keeps waiting. Give that work to an investigation job, with a clear question and an end. When you return, you can start with something to consider.

We'll use Robin, the fictional bicycle-shop owner considering maintenance classes, so you can judge the result against a small set of known facts. His practice hub is separate from your own. Use a real question instead if your hub can already reach the sources needed to answer it.

## Check the starting material

Check the starting material before setting a timer. In the practice hub, ask:

```
Confirm that this is robin-practice. Read AGENTS.md, profile/, inbox/workshop-notes.md and skills/prepare-a-decision/SKILL.md. Confirm the profile says Robin runs a bicycle repair shop. List any missing file. Create no job until these inputs are available.
```

If Robin's folder does not exist, unpack the matching companion kit and ask Hermes to create `robin-practice` beside your hub. Have it copy `starter-hub/` there, add the briefing and workshop note from `practice/maintenance-classes/`, and file that briefing into the practice profile. Also copy `skills/prepare-a-decision/SKILL.md` from the kit. Tell it to preserve existing folders and keep the fictional material out of your real hub. Open the new folder in Hermes and run the input check above.

If you are using your own question instead, ask the assistant to adapt the job below to your question, sources and a new output filename. Keep the one-time schedule and preparation-only limits.

The question is ordinary:

```
What should I do next about the maintenance classes?
```

A job that starts later needs more than the question. We'll save where to look, what to produce and when to finish. The aim is to leave all the instructions with the job, including the ones that seem obvious while you're typing.

## Save one run

Paste this in the practice folder:

```
Create a one-time investigation named robin-maintenance-once, due in 5 minutes. Use this practice folder as its working folder. Confirm the scheduler's named time zone and show the resolved next-run time. Do not use a repeating interval and do not trigger it manually.

Save this job prompt:
Read AGENTS.md and skills/prepare-a-decision/SKILL.md. Answer: What should Robin do next about the maintenance classes? Read profile/, what-my-ai-knew.md and inbox/workshop-notes.md. Use only those sources. Compare plausible options, distinguish evidence from assumptions, and identify gaps that could change the recommendation. Prepare an unsent customer interest message and questions about capacity and insurance. Do not invent a date, price, booking or external check. Write a new file at investigations/robin-maintenance-once.md; refuse to overwrite it. If a source is missing, record that failure and limit the answer accordingly. Send nothing, buy nothing and stop after writing the result.

Show the saved job record with its one-time schedule, working folder, time zone, output path and stop control. Record it in procedures.md as a practice job.
```

Before walking away, read the saved record. Look for `robin-maintenance-once`, one future run in the displayed time zone, your practice folder and the result path `investigations/robin-maintenance-once.md`. Together, they tell you what will run, when to expect it and where you'll find the work.

Keep the computer awake and its scheduler running through the scheduled time, then check the result without starting it manually. If the request fails to create the job, read the scheduling error and use the app's one-time control. Choose one future run. Robin needs help with a decision, not the same investigation delivered every morning.

## Read the prepared work

In an earlier practice run with a short delay, the job prepared this customer draft:

> "Hi! We are exploring a small bicycle-maintenance class at the shop. Would learning puncture repair interest you? We could also cover brake checks, let us know if you'd want that too. What days or times generally suit you? This is just an interest check, not a booking. Thanks, Robin."

The result compared testing interest with waiting, keeping the known facts apart from assumptions. Three enquiries stayed three enquiries. Nobody had booked a class, and the assistant hadn't made the choice easier by pretending otherwise.

Capacity and insurance still needed answers, so the instructions asked for questions Robin could use to get them. If you already have a document that answers a question, give the job access to it. Preparation should include the reading it can do, leaving you the questions that really need you.

Read the result as work you're considering using. Follow its recommendation back to the sources, look at the open questions and decide whether the draft is worth keeping. Then check the run history: the timer should have started the job, and no further run should be due.

If you leave the job until tomorrow, make sure the computer, scheduler and model access will be ready at the scheduled time. You're free to be elsewhere. The machine still has to turn up for work.

## Try a missing source

Ask the assistant to prepare a second practice copy without the workshop note, preserving the first copy. Have it create a new one-time job with a different output name. The answer should name the missing note. It may remember the customer counts from the conversation, but it mustn't describe them as facts it has just checked in a file.

Compare the two results before stopping or removing the practice jobs, and keep the output. You want useful preparation when the sources are present and an honest account of the gap when they aren't. That gives you a better basis for choosing your first real investigation.
