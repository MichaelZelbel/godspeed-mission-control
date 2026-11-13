See [factory workflow policy](factory/WORKFLOW_POLICY.md) for factory-specific shared-workflow requirements.

# Engineering conventions for Godspeed Mission Control

Read `AGENTS.md` first; it is the repository's own guide and wins where this file is silent.

- **Main changes only through a pull request** whose GitHub check `required` passed. Never push to
  `main`, `beta`, or a `candidate/*` tag.
- **The user guide.** Before you push, run `node .github/guide-check.mjs`. When nothing a reader sees
  changed, end your newest commit message with `Guide-Reviewed: none-needed (<why>)`. When a reader
  would see the change, say in the pull request which guide page needs updating: the guide lives in
  a private website repository this factory cannot reach, so the owner updates it.
- **Tests.** Every bug fix comes with a test that fails without the fix. The proving scenarios'
  own gate is `bash scenarios/test-scenarios.sh`; the tool tests are the ones `.github/workflows/required.yml`
  lists. Run the ones your change touches.
- **Plain language.** Comments, messages a person reads, and pull request text are written in plain,
  everyday English, without em dashes.
- **Running it.** `harness/RUNTIME.md` says how to start the notebook and run the checks on a server
  without touching anything outside the checkout.
- **Loop review comments.** On the factory's own pull requests (opened by the builder App,
  `godspeed-dev-builder[bot]`, from a branch of this repository) the merge gate
  (`.github/workflows/required-gate.mjs`) reads no review comment at all: `required` passes once every
  other check on the head commit passed, and the loop's reviewer and its land step decide the merge
  at the reviewed head. So a loop review needs no `Reviewed head` line for the gate's sake, and a
  `Loop review: not merged` comment does not turn `required` red. Only on a pull request someone
  else opened does a loop review count as a review, and then only an `approved` or `merging` one that
  names the exact head commit on a line `Reviewed head \`<full 40-character sha>\``.
