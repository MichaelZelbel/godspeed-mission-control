# Build queue policy: Godspeed Mission Control

This adds to the SDLC pack's default build policy.

## A check that runs only on a release candidate is not asked

Some checks exist only for a frozen release candidate, the tag `candidate/<version>`, which is
made after the release's pull requests merge: the scenario workflow on a candidate, "candidate
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
