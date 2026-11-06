# Merge queue policy: Godspeed Mission Control

This adds to the SDLC pack's default merge policy.

## A later release waits for the earlier release's candidate

Each release is planned in godspeed-dev (`releases/<id>/plan.md`), and its candidate is frozen from
main as the tag `candidate/<version>`. A pull request of a later release must not reach an earlier
release's candidate.
