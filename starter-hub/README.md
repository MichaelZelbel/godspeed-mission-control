# Appendix D: The Hub Folder Layout

Use this map when you want to know where something belongs. The installer in Chapter 3 creates the starting arrangement, along with the parts that make it work. Copying folders by hand won't give you that whole setup.

For example, the installer supplies commands such as `hub-due`, `hub-check-brief` and the rule compiler. It also configures the application, connects skill folders and can add optional machine jobs. Use the installation route for the exercises, then come back here when you need to look up a file.

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

If something looks missing, compare that item with the map and your kit version. Ask the assistant to repair the specific problem while keeping your work. A fresh template would also give you a fresh job of putting your own material back.
