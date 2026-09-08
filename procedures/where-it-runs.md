# Where scheduled work runs (Chapters 21 and 22)

## Give the job four parts

A scheduled job needs four things:

1. **Instructions:** a skill file describing the work and its limits.
2. **A start time:** once, or on a repeating schedule, in a named time zone.
3. **An output:** a new file in a folder you check, or a tested delivery channel.
4. **A running computer:** Hermes must be available there, with its files, model access and any required network connection.


When the assistant says it will check later, look for the saved job and its next run. Read the instruction it will receive. A promise in the conversation can sound settled long before anything is scheduled.

Your laptop is enough for this first exercise. Keep it awake with Hermes running. A server can do the work while the laptop is off, and Chapter 31 explains that option. There's no need to buy one before you've tried the job.

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
