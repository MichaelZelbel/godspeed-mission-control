# Appendix D: The Hub Folder Layout

This is a reference for the files installed in Chapter 3. Copying these folders by hand does **not** install an equivalent working system.

The installer also supplies commands, application configuration, skill discovery links and optional machine jobs. A manual folder copy does not provide `hub-due`, `hub-check-brief` or the rule compiler by itself. Use Chapter 3's installation route for the build-along exercises.

Open `starter-hub/` in the companion kit to inspect the initial layout. Show hidden files if your file browser hides dot-prefixed names; how a copy handles those files depends on the method used.

| Location | Purpose |
|---|---|
| `AGENTS.md` | Short instructions and pointers read by the assistant. |
| `profile/` | Background you confirmed, including people, projects and writing preferences. |
| `rules/` | Behavior instructions, compiled into the short rule list. |
| `observations/` | Useful findings and inferences, kept separate from confirmed profile facts. |
| `inbox/` | New captures, writing samples and unresolved questions. |
| `archives/filed-captures/` | Original captures after clear facts have been filed. |
| `skills/` | Reusable job instructions, one `SKILL.md` per skill. |
| `decisions.md` | Dated decisions and their reasons. |
| `procedures.md` | What runs automatically and how to stop it. |
| `prompts/library/` | Prompts deliberately saved for reuse. |
| `prompts/archive/` | Optional collected conversation text; collection defaults off. |
| `world/` | Dated records and supported notebook-derived copies, identified by source. |
| `due/` | Deadline entries and their local history. |
| `secrets/` | Instructions and protected credential material; never plaintext keys in ordinary tracked files. |
| `dev/` | Optional separate coding projects. |
| `.gitignore` | Files excluded from Git tracking. It does not remove already saved history. |
| `CLAUDE.md` | Guidance for the developer tool to find the hub's shared instructions. |
| `.mcp.json`, if used | Client connection configuration referring to credential names, not literal secrets. |

The exercises add output folders such as `brief/`, `reviews/`, `investigations/` and `watch/` when needed. Their absence in a fresh hub is normal.

If an installed folder looks wrong, compare the exact missing item with this map and the kit version. Ask the assistant to inspect and repair that item while preserving existing work. Do not replace your whole hub with a fresh template.
