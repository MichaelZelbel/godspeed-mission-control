# Merge queue policy: Godspeed Mission Control

This adds to the SDLC pack's default merge policy.

## A pull request of an approved release is merged without asking

The maintainer hears only decisions that are his. Release promotion (making a candidate public)
is his own go, decided in godspeed-dev and unchanged by this section. Merging a pull request that
belongs to a release he has already approved is not a new decision, and the queue does not ask it.

- A pull request whose linked issue's body names a release directory
  `releases/godspeed-<version>-<slug>` in godspeed-dev whose plan is approved, or says the item was
  carried into such a release, is merged without asking once the default's gate and its "Before a
  merge" rules are met. Its size label does not matter.
- To decide it, take the default's "Unclear" reasons that apply to the pull request and set aside
  exactly two: "Large changes", and "Partial work" for being one part of that release's plan. If
  no reason is left, the pull request is `clear`, so an `archon-size-l` pull request of an approved
  release merges. If any reason is left, the queue asks, as the default says.
- Every other pull request keeps the pack's default.
- Reason: Michael, 2 November 2026, after two pull requests sat unmerged for hours: "why does it
  not just do its job". Nearly every factory ticket is sized large, so the default asked about
  almost all of them, and the answer was always "merge".
