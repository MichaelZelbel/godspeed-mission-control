# Appendix D: The Hub Folder Layout

Come here when you're looking for a file or wondering where a note belongs. Chapter 2's installer creates the starting folders and the parts that make them work.

Those parts include commands such as `hub-due`, `hub-check-brief` and the rule compiler. The installer also configures the application, connects skill folders and can add optional machine jobs. That's why the exercises begin with installation: a set of empty folders wouldn't yet be a working hub.

You can see the initial layout in `starter-hub/` in the companion kit. Some file browsers hide names that begin with a dot, so turn on "show hidden files" if those seem to be missing. Copying methods differ in whether they include these files.

| Location | Purpose |
|---|---|
| `AGENTS.md` | Short instructions and pointers read by the assistant. |
| `profile/` | Background you confirmed, including people, projects and writing preferences. |
| `rules/` | Behavior instructions, compiled into the short rule list. |
| `observations/` | Useful findings and inferences, kept separate from confirmed profile facts. |
| `inbox/` | Unresolved material, writing samples and notes you asked to leave untouched. Clear updates are filed during the work. |
| `archives/filed-captures/` | Original captures after clear facts have been filed. |
| `skills/` | Reusable job instructions, one `SKILL.md` per skill. |
| `decisions.md` | Dated decisions and their reasons. |
| `procedures.md` | What runs automatically and how to stop it. |
| `prompts/library/` | Prompts deliberately saved for reuse. |
| `prompts/archive/` | Optional collected conversation text; the taught setup leaves collection off. |
| `world/` | Local people, events and facts; optionally also copies imported from Menerio. Each record identifies its source. |
| `due/` | Deadline entries and their local history. |
| `secrets/` | Instructions and protected credential material; never plaintext keys in ordinary tracked files. |
| `dev/` | Optional separate coding projects. |
| `.gitignore` | Files excluded from Git tracking. It does not remove already saved history. |
| `CLAUDE.md` | Guidance for the developer tool to find the hub's shared instructions. |
| `.mcp.json`, if used | Client connection configuration referring to credential names, not literal secrets. |

The exercises add folders such as `brief/`, `reviews/`, `investigations/` and `watch/` as you need them. A fresh hub won't yet contain all those folders.

If a file seems to be missing, compare it with this map and your kit version. Ask the assistant to repair that part while keeping your work. You don't need to start again with an empty template just to fix one missing piece.
