# Build queue policy: Godspeed Mission Control

This adds to the SDLC pack's default build policy.

## A check that runs only on a release candidate is not asked

Some checks exist only for a frozen release candidate, the tag `candidate/<version>`, which is
made after the release's pull requests merge: the scenario workflow on a candidate (a whole candidate run; see the next section for the scenario a pull request itself runs), "candidate
acceptance", and the "installed-candidate" and "credential-backed candidate" runs. No round and
no person can run one at a pull request's head, so the queue neither waits for one nor asks about
one.

- When the pull request's latest review says Ready at its head commit and CI marked it ready, the
  item is Done and goes to the merge queue, even if the review lists a candidate-only check as
  deferred. This sets aside the default's "ask once for a check no round can run" for these checks.
- The release's next candidate runs the check. If it fails there, it comes back as a new issue
  with that run as evidence.
- A discovery the round validated outside its scope is filed through the discoveries policy, never
  left in a question.
- A live round trip with real credentials that is not a candidate scenario is not covered here:
  it is still a check only a person can make, and the queue still asks, as the default says.
- Everything else keeps the default.
- Reason: Michael, 2 November 2026: the maintainer hears only decisions that are his ("why does it
  not just do its job"). In one evening the queue asked four times for a candidate scenario run at
  a pull request's head (#307, #308, #306, #309). It cannot be answered before the merge, and each
  answer was "merge now, the next candidate proves it".

## A pull request that changes a scenario is Done only when its scenario check is green

A pull request that changes a proving scenario that has a job in `.github/workflows/scenarios.yml`
runs that scenario on its own code, as a check of the workflow "scenarios on pull request N": the
job `the stage file`, one job for each such scenario it changed, and `the verdict`. A scenario has
such a job when the workflow runs `bash scenarios/<name>.sh "$STAGE_REF"` in a job of that name
(`scenarios/<name>.sh` or a file named `scenarios/<name>-*` picks it). A proving scenario with no
such job (the ones `scenarios/README.md` lists as not in the workflow), the install, Docker and
update jobs, and the candidate-only Windows scenario are not run on a pull request.
Unlike the candidate-only checks above, a round can read this one at the pull request's head.

- Such a pull request is Done only when the review says Ready at its head commit, CI marked it
  ready, and every job of that scenarios run at the head commit is green, `the verdict` included.
- A red or cancelled scenario job is not a question and not a deferral: the queue continues the
  item itself, reads the job's log, corrects its own fix and pushes. The next push runs the
  scenario again; an older run of the same pull request is cancelled by it.
- A scenario job that is still running is waited for, never skipped over.
- A pull request that changes no scenario script has no scenario job (only the stage and the
  verdict run), and nothing here applies. A change to a shared scenario library or to product code
  alone picks no scenario; the default and the candidate section above still decide.
- Reason: Michael, 8 November 2026. Eight scenario fixes merged on 7 November after review and unit
  tests, and most still failed on the next candidate (8 November, run 42470722177), because
  scenarios ran only at night and on a candidate. The factory has to be fast and efficient: a fix is
  proved where it is made.
