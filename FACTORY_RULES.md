# Project workflow guidance

Keep project constraints and irreversible-action requirements in this file and the
native project guidance. Shared workflow gates own authorization. The factory does
not interpret this document as a private merge policy.

Preserve scope, tests, security invariants and secrets. Report failed or unavailable
checks truthfully. Ordinary static/unit success does not replace required runtime
or holdout verification. Each required assertion needs observable evidence.

Specify this application's protected paths, required validation coverage and
publication constraints in the shared workflow's supported inputs.

**Irreversible actions stop the factory.** Changing identity, authentication or who
may act as whom, and migrating or deleting stored data, are never decided by an
agent: an issue that needs one is held for a human.

**A weekly test failure is an ordinary bug.** Every scenario runs once a week
(`.github/workflows/scenarios-weekly.yml`), and only the release gate (`scenarios/scenario-gate.tsv`)
runs at night and on a candidate. An issue titled `Weekly test failed: <scenario>`, labelled
`weekly-test`, is not "a real failure on main" in the sense that sends a nightly failure to the top
of the order: it is never `priority`, and it never holds up a release. Order it like any other bug,
behind the release's own tickets. Only a `Nightly scenario failed` issue, or a failure on a candidate
run, is urgent.
