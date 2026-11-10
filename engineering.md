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
