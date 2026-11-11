# Factory operations

This application runs on a pinned Archon SDLC source. See
[factory/MIGRATION.md](factory/MIGRATION.md) for installing and upgrading it.

Shared workflow gates own every decision. Inspect a run's identity and status
before responding to a declared gate.

Project runtime scenarios: `harness/END-TO-END.md`.
Holdout scenarios: `.factory/holdout/HOLDOUT.md`, fenced by `.factory/hooks/holdout_fence.py`
(only the holdout-writer and holdout-verifier subagents may read it).
Ordinary checks: `python harness/ci.py`.

Record this application's tested source SHA, candidate, run IDs, coverage,
fresh-environment evidence and open integration limits here after testing.

## Open integration limits (2026-11-10, first trial)

- The notebook has no build-id endpoint, so `factory/runtime_host.py` and `harness/runtime.inputs.json`
  are not used yet; the app check follows `harness/RUNTIME.md` (passed as the loop's `runtime` input)
  and proves which code it ran by the checkout's `git rev-parse HEAD`.
- No holdout scenarios yet; the first trial issue is a test-tool change checked at light depth.
- The notebook's web pages need a frontend build and a whole install needs a throwaway machine;
  neither is covered by the journeys yet.
