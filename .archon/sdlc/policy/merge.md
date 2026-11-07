# Merge queue policy: Godspeed Mission Control

This adds to the SDLC pack's default merge policy.

## A later release waits for the earlier release's candidate

Each release is planned in godspeed-dev (`releases/<id>/plan.md`), and its candidate is frozen from
main as the tag `candidate/<version>`. A pull request of a later release must not reach an earlier
release's candidate.

- While the tag `candidate/2.0.0-beta.19` does not exist on the remote (`git ls-remote --tags
  origin refs/tags/candidate/2.0.0-beta.19` prints nothing), a pull request whose linked issue's body
  names `releases/godspeed-2.0.0-beta.20-nothing-private-left` is neither merged nor asked: its action
  is `wait`, and its reason says it waits for 2.0.0-beta.19's candidate. Review, fixes and CI go on
  as usual. Once the tag exists, this line no longer applies and the pull request is decided like
  any other.
- This line is removed in 2.0.0-beta.20's release step.

## A pull request of an approved release is merged without asking

The maintainer hears only decisions that are his. Release promotion (making a candidate public)
is his own go, decided in godspeed-dev and unchanged by this section. Merging a pull request that
belongs to a release he has already approved is not a new decision, and the queue does not ask it.

- A pull request whose linked issue's body names a release directory
  `releases/godspeed-<version>-<slug>` in godspeed-dev whose plan is approved, or says the item was
  carried into such a release, is merged without asking once the gate passes: a trusted Ready
  verdict at its exact head, CI green there, the default branch's CI not red, and a clean merge.
  Its size label does not matter.
- To decide it, take the default's "Unclear" reasons that apply to the pull request and set aside
  exactly two: "Large changes", and "Partial work" for being one part of that release's plan. If
  no reason is left, the pull request is `clear`, so an `archon-size-l` pull request of an approved
  release merges. If any reason is left, the queue asks, as the default says: a persisted schema,
  migration or stored or wire format, authentication, credentials or permissions, a review that
  lists contract items as not yet met, or anything a release or the project's direction depends on
  without a ruling.
- The wait rule above still wins: a pull request that waits for an earlier release's candidate
  stays `wait`, approved release or not.
- Every other pull request keeps the pack's default.
- Reason: Michael, 2 November 2026, after two pull requests sat unmerged for hours: "why does it
  not just do its job". Nearly every factory ticket is sized large, so the default asked about
  almost all of them, and the answer was always "merge".
