# Research Watch Setup (Chapter 29)

A research watch keeps one open question alive between searches: whether a
tool still fits, whether a feature has arrived, whether a better choice has
appeared. It rechecks named sources on a rhythm, remembers what it already
found, and brings back only what changed or what it could not read.

What you end up with:

- one folder per question under `watch/`, holding its `requirements.md`, the
  options it compares, a dated result for every run, `findings.md` and a
  one-line-per-run `log.md`;
- one shared recipe, `skills/research-watch/SKILL.md`, for every question;
- one daily job that checks only the questions that are due;
- a Research section in your morning brief.

Start with one question and a few named sources. Every check uses model time
and may use paid search, so let the first watch earn its place before you add
more.

## Step 1: start one watch

In a session with your folder attached, say what the question is, then paste
this. It installs the complete recipe from this kit and writes the question
down, and it researches nothing yet:

```
Set up one research watch for the question I describe. Read relevant existing notes first. Ask only for missing information: what would count as better, which sources to trust, how often to check, and which findings would change a decision.

Find the matching unpacked companion kit, asking for its location only if needed. Read its complete research-watch skill. Install it as skills/research-watch/SKILL.md in this mission control. If a skill already exists there, compare it and preserve my changes; show a proposed merge rather than replacing it.

Create watch/<short-name>/requirements.md using the format required by that skill. Find and inspect the relevant source pages yourself; ask me about a source only when access or identity is uncertain. Fill the file with our agreed question, the verified source URLs, criteria and check interval. Use the skill's UTC dates for its internal records. Create its supporting folders and empty records. Do not run the research comparison or schedule anything yet. Show the question and requirements in ordinary language so I can correct them.
```

*[Copy prompt](https://querino.ai/prompts/start-a-research-watch)*

Before going on, check that the saved requirements name the actual pages and
the actual problem. "The official website" is too vague when one page lists
features and another describes limits.

## Step 2: run it once, by hand

```
Read AGENTS.md and skills/research-watch/SKILL.md. Run the due research watches in this mission control now. Show the resulting attempt lines, source coverage, open findings and next check dates. Do not create a schedule or send a notification.
```

*[Copy prompt](https://querino.ai/prompts/run-my-research-watches)*

A success means every required source was read. A source that failed keeps
its last known evidence as old evidence, gets an open failed-check finding and
a retry date. To see all three outcomes safely, ask for a separate practice
watch that reads a local text file labelled as fiction: run it unchanged, with
one changed claim, and with the file missing, as forced practice checks.

## Step 3: one daily job for every question

If an older job already watches the same subject, pause that schedule first
and keep its report as history. Then:

```
Inspect existing jobs and create or update one daily job named research watches, at 06:30 in the same named time zone as my morning brief. Save this mission control's full path as its working folder. Its prompt is: Read AGENTS.md, then follow skills/research-watch/SKILL.md for the due watches in watch/. Write results only; send nothing externally.

Show the actual saved job, working folder, named time zone, next run and pause control. The starter skill still records UTC dates; the timer's displayed zone is a separate setting. Check that an older schedule for the same subjects is paused. Update procedures.md. If the scheduler uses another time zone, resolve and show the equivalent next run before relying on it.
```

*[Copy prompt](https://querino.ai/prompts/schedule-daily-research-watches)*

The job wakes daily but researches only the questions that are due. A weekly
question keeps its weekly pace unless a failure calls for an earlier retry
(`retry_days: 1` in its requirements means tomorrow).

## Step 4: findings in the morning brief

```
Update skills/morning-brief/SKILL.md to read each active watch's requirements.md, findings.md and latest log lines. Add a Research section after the normal body.

Use the research skill's UTC due-date rules to check whether a required run is missing or overdue. Read the common schedule's latest run record if accessible. An empty log means no completed check exists. An old success does not prove the latest scheduled check happened. Report a missing or overdue check with its last success and next retry when known. If the schedule record cannot be read, say its status is unknown. Do not invent a failure record or change research state during brief generation.

Include every unresolved urgent finding and every open failed-check notice, with its age, source and next retry when known. Summarize useful findings once when possible; background remains in the research files. Do not delete or resolve a finding because it was omitted or already mentioned. A repeated unresolved urgent finding may be labelled still open instead of presented as fresh news.

Keep the normal body under 200 words. Required urgent and failed-check text is additional and must not be silently shortened away. Use direct source links and include the practical finding itself. Name the file a fact came from only on Sources: lines. Do not publish private material to obtain a link.

Test in a disposable mission control with a separate output at practice/brief-tests/research-test.md. Include an urgent finding, an unchanged useful finding, a failed source and an overdue watch whose last recorded run succeeded. The overdue watch must remain visible even though it has no failed-source finding. Preserve today's real brief and do not change real research state during the test.
```

*[Copy prompt](https://querino.ai/prompts/put-research-findings-in-the-morning-brief)*

Leave time between the two jobs. A 06:30 research start gives a 07:00 brief
half an hour; several due questions or a slow source can need longer.

## The off-switch

To stop one question and keep everything it found:

```
Pause the subject I name by setting status: paused in its requirements.md. Preserve its candidates, findings, results and log. Confirm the next common run will skip it. If I name all research watches, also pause the research watches schedule and inspect whether a run is already active. Update procedures.md with what was stopped.
```

*[Copy prompt](https://querino.ai/prompts/pause-a-research-watch)*

When your needs change, edit the same `requirements.md` rather than starting
a new watch; the earlier research stays as the starting point.

## The recipe

`skills/research-watch/SKILL.md` in this kit is the whole method: the
requirements format, when a watch is due, at most five source pages and ten
minutes per watch, the dated result for every attempt, one finding per
distinct claim so nothing is announced twice, and failed sources that stay
visible with a retry date. The Step 1 prompt installs it; you do not write it.

## Then the register

The schedule prompt records the daily job in `procedures.md`. One block for
all your questions, because there is one job however many you keep. Nothing
runs unlisted.
