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

A pull request that changes a proving scenario runs that scenario on its own code, as a check of
the workflow "scenarios on pull request N": the job `the stage file`, one job for each scenario the
workflow selected, and `the verdict`. Which scenarios are selected is decided by the workflow alone:
the `stage file` job's step "Which scenarios this run proves" writes the selection (`picked`) in its
summary. A scenario the workflow does not select has no job on a pull request, however it is
documented elsewhere; do not look for one.
Unlike the candidate-only checks above, a round can read this one at the pull request's head.

- Such a pull request is Done only when the review says Ready at its head commit, CI marked it
  ready, and every job of that scenarios run at the head commit is green, `the verdict` included.
- A red or cancelled scenario job is not a question and not a deferral: the queue continues the
  item itself, reads the job's log, corrects its own fix and pushes. The next push runs the
  scenario again; an older run of the same pull request is cancelled by it.
- A scenario job that is still running is waited for, never skipped over.
- A pull request from a fork has no secrets, so no scenario job runs on it (the stage is skipped and
  its verdict passes with "No scenario runs on a pull request from a fork"). That passing verdict is
  not scenario proof and the rules above do not apply to it: the default and the required gate decide.
- A pull request for which the workflow selected no scenario has no scenario job (only the stage
  and the verdict run), and nothing here applies: the default and the candidate section above still
  decide.
- Reason: Michael, 8 November 2026. Eight scenario fixes merged on 7 November after review and unit
  tests, and most still failed on the next candidate (8 November, run 42470722177), because
  scenarios ran only at night and on a candidate. The factory has to be fast and efficient: a fix is
  proved where it is made.

## A build round never changes `.github/workflows/`

The builder key is kept away from `.github/workflows/` by design: a build must not be able to change
the checks that judge it. GitHub refuses any push from it that creates or updates a workflow file.

- No commit of a build round touches a file under `.github/workflows/`, in any round.
- When the fix needs a workflow change, the round commits everything else and writes the change to
  `.github/workflow-drafts/<same file name>` as the complete new content of that workflow file, not
  a fragment. It quotes the change in the pull request description under "Workflow change for the
  release key", together with a manifest of four lines: the target path under `.github/workflows/`;
  the operation (create, replace or delete; a delete has no draft content); the git blob hash of the
  target on the base commit the draft was written against (none for a create) and the blob hash of
  the draft; and the exact names of the scenario jobs that need the change.
- Such a pull request is Done when the review says Ready at its head commit and its checks are green,
  apart from the scenario jobs named in the manifest and no others. The review checks that the
  manifest matches the draft.
- Mission Control then applies the draft with the release key to the target path, only after
  confirming the target's current blob hash equals the manifest's base hash and the draft's hash
  equals the result hash; on a mismatch it applies nothing and sends the pull request back for a
  redo. It then removes the draft file.
- A publish refused for this reason is never retried. The round redoes the change the drafted way:
  it drops the workflow hunk from its commits and writes the draft. A new round that repeats the same
  refused push is the mistake this rule prevents.
- Everything else keeps the default.
- Reason: Michael, 8 November 2026. Issue #340 was built nine times in three hours with the same
  refused push, because the queue started another round each time, and #333 stopped to ask for a
  permission the guard exists to withhold. Drafting the change (as #319 and #321 did) keeps the
  guard and lets the work finish.
