# info, upgrade, compositions, docs, benchmark, telemetry, asset preprocessing

Catch-all reference for commands that don't fit the main dev loop.

## info

```bash
mc-video hyperframes info                   # project metadata
mc-video hyperframes info ./my-video        # specific project
mc-video hyperframes info --json
```

Prints **project** metadata: name, resolution, duration, element counts by type, track count, and total project size. Project-level — not environment. For environment health use `doctor`.

## upgrade

```bash
mc-video hyperframes upgrade                # check + interactive prompt
mc-video hyperframes upgrade --check        # check and exit, no prompt (agent-friendly)
mc-video hyperframes upgrade --check --json # machine-readable: current / latest / updateAvailable
mc-video hyperframes upgrade --yes          # print upgrade commands without prompting
```

Compares the installed CLI version against npm latest.

`--project [dir]` bumps a **project's** pinned scripts instead of the global install: it rewrites every `npx …hyperframes@<version>…` in `<dir>/package.json` (default cwd) to npm-latest. Always invoke it unpinned (`mc-video hyperframes upgrade --project`) — a project scaffolded on an old CLI stays frozen otherwise. `--project . --check` reports the delta without writing; add `--json` for `{ changed, from, to, path }`. Pass the dir explicitly whenever another flag follows `--project` — on older releases a bare `--project` consumes the next flag as its directory value.

## compositions, docs

```bash
mc-video hyperframes compositions           # list compositions in project
mc-video hyperframes compositions --json
mc-video hyperframes docs                   # list available topics
mc-video hyperframes docs rendering         # print one topic inline in the terminal
```

`compositions` lists every `data-composition-id` in the project (including sub-comps) with duration, resolution, and element count.

`docs` prints inline documentation **in the terminal** — it does not open a browser. Topics: `data-attributes`, `examples`, `rendering`, `gsap`, `troubleshooting`, `compositions`. Run without a topic to see the list.

## benchmark

```bash
mc-video hyperframes benchmark              # run the preset matrix in current project
mc-video hyperframes benchmark ./my-video   # specific project
mc-video hyperframes benchmark --runs 5     # repeat each config N times (default 3)
mc-video hyperframes benchmark --json
```

Renders the project with 5 preset configurations — `30fps draft 2w`, `30fps standard 2w`, `30fps high 2w`, `30fps standard 4w`, `60fps standard 4w` — and prints a comparison of render speed and output file size. Use it to find the fastest acceptable preset for your machine. Not a single-render-with-stage-breakdown.

## telemetry

```bash
mc-video hyperframes telemetry status      # show telemetry state
mc-video hyperframes telemetry disable     # disable anonymous usage telemetry
mc-video hyperframes telemetry enable      # re-enable telemetry
```

Telemetry is anonymous usage counters only. Disable globally with `HYPERFRAMES_NO_TELEMETRY=1` if env-var control is preferred over the subcommand.

Events include two fingerprint properties used to distinguish managed-sandbox runs from real laptops — no PII, no env-var **values**, only existence checks:

- **`sandbox_runtime`**: `gvisor` / `firecracker` / `docker` / `kvm` / `wsl` / `null`. gVisor via kernel string + `/proc/version`. Firecracker via `/dev/vsock` + DMI sys_vendor. Docker via `/.dockerenv` + cgroup.
- **`agent_runtime`**: `claude_code` / `codex` / `cursor` / `copilot_agent` / `jules` / `replit` / `devin` / `aider` / `gemini_cli` / `hermes` / `openclaw` / `null`. Detected by the existence of well-known vendor env vars; the values themselves are never read.

## Asset Preprocessing

```bash
mc-video hyperframes tts
mc-video hyperframes transcribe
mc-video hyperframes remove-background
```

These produce assets (narration audio, word-level transcripts, transparent video) that get dropped into a composition. Each may download its own model on first run.

For voice selection, Whisper model rules, output format choice, and the TTS → transcript → captions chain, invoke the `media-use` skill. This skill stays focused on the dev loop.
