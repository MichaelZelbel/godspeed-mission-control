# Chapter 25: Keep Researching a Question Over Time

The search is over for today; the question isn't. A tool almost fits your needs, a feature may arrive, or a better choice may appear next month. When you ask again, you want the assistant to build on what you've already considered, with your requirements and the evidence still attached.

One of my questions was whether the service I used for publishing posts still met my needs. I expected to learn about features. I also had to leave room for the possibility that the service was fine and I was using it badly.

Begin with one question and a few named sources. Every check uses model time and may use paid search, so see whether the first watch earns its place before adding more.

## Give the assistant a question it can return to

Suppose your publishing tool cannot place the cover picture where you need it. A useful watch checks that particular feature and your current setup. “Find the best publishing tool” would send it shopping before it knows what went wrong.

Ask Hermes to prepare the watch. Give it the unpacked companion kit's location, then paste:

```
Set up one research watch for the question I describe. Read relevant existing notes first. Ask only for missing information: what would count as better, which sources to trust, how often to check, and which findings would change a decision.

Read the complete research-watch skill in the companion kit at the location I give you. Install it as skills/research-watch/SKILL.md in this hub. If a skill already exists there, compare it and preserve my changes; show a proposed merge rather than replacing it.

Create watch/<short-name>/requirements.md using the format required by that skill. Fill it with our agreed question, specific source URLs, criteria and check interval. Use the skill's UTC dates for its internal records. Create its supporting folders and empty records. Do not research or schedule anything yet. Show the question and requirements in ordinary language so I can correct them.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-26-box-1)*

UTC is the common time reference used for the watch's dated records. Your morning schedule can still use your local time zone. The assistant handles that conversion; you choose how often the question deserves attention.

The kit's complete skill supplies the filing and retry instructions. You do not need to write them. Before using it, check that the saved requirements name the actual pages and the actual problem. A source called “the official website” is too vague when one page lists features and another describes limits.

## Know what each check leaves behind

Each question has its own folder under `watch/`. The skill reads its requirements and previous result, checks the named sources, then saves a dated result. It keeps a short log of attempts and a list of findings that still need attention. All questions share this one skill, so adding a subject does not create another method to maintain.

The first run establishes what the sources say now. A later run compares new evidence with that record. Check both whether the research finished and whether anything relevant changed:

| Result | What it means for you |
|---|---|
| Complete check with a relevant change | Read the changed finding and the evidence for it. |
| Complete check without a relevant change | Keep the record without announcing the same finding again. |
| Incomplete check | Keep useful partial work, with unread sources and retry dates clearly marked. |

The starter limits each watch to five source pages and ten minutes per run. If the limit leaves a required source unread, the result stays incomplete. A failed check gets a retry date instead of a success date. An urgent finding stays open until you resolve it or new evidence explains why it no longer applies.

These instructions give the assistant a method. They are not a guarantee that every future run will follow it, so the first test needs a source whose changes you can judge.

Ask Hermes to make a separate practice watch that reads a harmless local text file, clearly labelled as fiction. Have it test the file unchanged, with one changed claim, and with the source absent. Ask it to label these as forced practice checks, so the normal waiting interval does not make it skip them. Keep your real sources and research history untouched.

## Run it once before scheduling

```
Read AGENTS.md and skills/research-watch/SKILL.md. Run the due research watches in this hub now. Show the resulting attempt lines, source coverage, open findings and next check dates. Do not create a schedule or send a notification.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-26-box-4)*

With an empty log, the first check should begin straight away. Read its source list: a successful check must have read every required source. A failure should retain the last known evidence as old evidence, record what couldn't be read and set a retry date. That lets you use the work it completed without mistaking the gap for fresh information.

In the practice results, the unchanged claim should keep its existing finding rather than produce a copy. The changed claim needs new evidence; the missing source needs a visible failure. Ask the assistant to restore the practice source and check again. A successful read should clear that source's failure while preserving the record of what happened.

## Replace the older watch before adding the common schedule

If an existing watch already checks this subject, ask the assistant to pause that schedule before moving the subject here. Keep its earlier report and create the new requirements folder beside it. The old report remains useful history, with its date showing how old the evidence is.

Now give all the subjects one daily job. It will check which ones are due, so a weekly question can share the same timer with one checked at another interval:

```
Inspect existing jobs and create or update one daily job named research watches, at 06:30 in the same named time zone as my morning brief. Save this hub's full path as its working folder. Its prompt is: Read AGENTS.md, then follow skills/research-watch/SKILL.md for the due watches in watch/. Write results only; send nothing externally.

Show the actual saved job, working folder, named time zone, next run and pause control. The starter skill still records UTC dates; the timer's displayed zone is a separate setting. Check that an older schedule for the same subjects is paused. Update procedures.md. If the scheduler uses another time zone, resolve and show the equivalent next run before relying on it.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-25-text-3-20260913)*

The shared job wakes daily, but it researches only the questions due for a check. A weekly subject keeps its weekly pace unless a failure calls for an earlier try. With `retry_days: 1`, it can retry tomorrow, giving a temporarily unavailable page another chance without waiting a whole week.

## Put the findings in the morning brief

```
Update skills/morning-brief/SKILL.md to read each active watch's requirements.md, findings.md and latest log lines. Add a Research section after the normal body.

Use the research skill's UTC due-date rules to check whether a required run is missing or overdue. Read the common schedule's latest run record if accessible. An empty log means no completed check exists. An old success does not prove the latest scheduled check happened. Report a missing or overdue check with its last success and next retry when known. If the schedule record cannot be read, say its status is unknown. Do not invent a failure record or change research state during brief generation.

Include every unresolved urgent finding and every open failed-check notice, with its age, source and next retry when known. Summarize useful findings once when possible; background remains in the research files. Do not delete or resolve a finding because it was omitted or already mentioned. A repeated unresolved urgent finding may be labelled still open instead of presented as fresh news.

Keep the normal body under 200 words. Required urgent and failed-check text is additional and must not be silently shortened away. Use direct source links and include the practical finding itself. Name the file a fact came from only on Sources: lines. Do not publish private material to obtain a link.

Test in a disposable hub with a separate output at practice/brief-tests/research-test.md. Include an urgent finding, an unchanged useful finding, a failed source and an overdue watch whose last recorded run succeeded. The overdue watch must remain visible even though it has no failed-source finding. Preserve today's real brief and do not change real research state during the test.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-25-text-4-20260913)*

Leave time between the research and the brief for a slow run to finish. The 06:30 research start gives a 07:00 brief half an hour, but several due questions or a slow source can need longer. Check that your brief reads completed results and reports failed or missing runs. If research isn't ready, you should see that gap instead of yesterday's answer dressed as this morning's work.

## What my first watch found

My first publishing-tool investigation found the cover-picture field I needed in the service's YouTube reference. It also found that my app sent the picture to a different destination and omitted it where the field existed.

I had gone looking for a better service and found a mistake in my own app. Less flattering, considerably more useful. Before replacing the tool, I needed to check how I was using it.

The starter keeps findings in files you can open, and the morning brief brings the relevant ones to a place you already read. I wanted this answer beside the work I was going to look at anyway, where it had a better chance of becoming a fix.

## Stop without losing the record

```
Pause the subject I name by setting status: paused in its requirements.md. Preserve its candidates, findings, results and log. Confirm the next common run will skip it. If I name all research watches, also pause the research watches schedule and inspect whether a run is already active. Update procedures.md with what was stopped.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-25-text-5-20260913)*

When your needs change, edit the same requirements file and keep the earlier research as a starting point. Teaching it once should spare you repeated explanations. It shouldn't oblige you to defend last month's preferences forever.
