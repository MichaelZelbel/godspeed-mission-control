# Chapter 20: Prepare a Job to Run on a Schedule

So far, the assistant has waited for you to open Hermes and ask. That's useful while you're teaching it. Once the job is familiar, though, remembering to ask can become another small task you carry around. A morning brief would be more welcome if it arrived before you remembered you needed it.

A schedule supplies that first nudge. The useful part is what waits for you afterwards: work you can read, sources you can check and choices you can make. We'll prepare the job around that result.

## Give the job four parts

To get from an instruction to work waiting for you, put four things in place:

1. **Instructions:** a skill file describing the work and its limits.
2. **A start time:** once, or on a repeating schedule, in a named time zone.
3. **An output:** a new file in a folder you check, or a tested delivery channel.
4. **A running computer:** Hermes must be available there, with its files, model access and any required network connection.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

Look for these details in the saved job when the assistant promises to check later. Its next run time and instructions show what has actually been arranged. Also choose an output folder you already open: work saved somewhere you never look becomes a diary the assistant keeps to itself.

Start on your laptop so you can watch the first job work. An awake computer is necessary, but Hermes' scheduler must be running too. The desktop app can supply that service; a terminal conversation alone does not. Ask Hermes to inspect how scheduled jobs start in your installation and identify the active process. If you later use a server, the same requirements apply there.

## Check whether the skill can find its input

Before scheduling a skill, check whether it can find everything you normally hand it during a conversation. Ask Hermes:

```
Read the skill I want to schedule. Could it run without another message from me, using only the files and tools it can already reach?

Mark it ready or not ready. For each missing input, name exactly what is needed and where the skill currently expects to get it. Also check its output destination, limits and stopping condition.

Do not change files or create schedules.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-21-box-1)*

The email skill may write beautifully while still depending on you to supply the email. A meeting skill may need a name and a date. Put those inputs where the job can find them. Otherwise you've arranged an early start for an assistant with nothing to do.

In an earlier test, I checked seven skills. Six still needed a message from me. They were useful skills; they simply expected me to supply part of the job. The seventh was a morning brief that could read its inputs from saved project notes.

The email skill's verdict made the problem plain:

> - `answer-email-my-way`: Missing input: expects "I will give you an email"; a stranger has no email to reply to.

“Ready” here means it can find the material without asking you. Read the first result to find out whether it can also do the work well.

## Give the work an end

“Research ways to improve my life” has no useful stopping point. “Read these project notes and prepare three options for Friday's decision” does.

Give missing information an ending too. Tell the job to show the gap, prepare what the sources support, then finish. Otherwise a reasonable question can leave it waiting all night for an answer from someone who is asleep.

Keep permission to prepare separate from permission to act. A customer draft can wait in a file. Sending it still requires your approval of the actual message and recipient.

## Record what runs and how to stop it

Keep a list of automatic jobs in `procedures.md`, including where each runs and how to stop it. The file records your arrangements; it doesn't start the jobs. I want you to be able to inspect the list and recognise every entry, especially after several weeks of adding things.

```
Inspect the schedules you can actually reach. Update procedures.md with one block per automatic job. For each block record:

- what it does and which skill it uses;
- the computer and working folder;
- the schedule, time zone and next run;
- where the result and run history appear;
- what it may read, change or send;
- the exact pause or removal control;
- when its behavior was last checked and what remains untested.

Mark planned jobs as not scheduled. Do not invent a job or a successful test from a conversation about one. Report any schedule you could not inspect.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-21-box-2)*

If the inspection finds an existing job, try its stop control while stopping is an exercise rather than an urgent search. If you have no jobs yet, keep the empty list; the first morning brief will give you one to record. Leave unfinished plans marked "not scheduled" until the schedule is saved. A record with an honest gap is more useful than one that makes your plans look complete.

For a morning brief, use `brief/` in your hub as the output folder. Let the assistant create it and record the saved job. A local result is enough to begin; phone delivery is a separate connection to test when you need it.
