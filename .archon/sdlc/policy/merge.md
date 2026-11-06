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
