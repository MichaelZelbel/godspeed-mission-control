# Installed full-alpha verification

The tested Windows installer and VPS archive were installed separately from production. Both devices use independent approved Hermes OpenAI Codex subscription sign-ins. The server alone consumes the authorized test Telegram bot; an actual incoming message and model reply were verified.

The notebook now reuses Menerio's DashboardLayout, sidebar, search, creation controls, theme, note editor, dashboard widgets and contextual chat components. Godspeed Mission Control branding replaces the active Menerio logo. Settings holds installation controls. The note's chat and floating contextual chat retain saved history; expansion, collapse, fullscreen and opening the same note in a separate tab were checked in the running browser.

Installed checks used synthetic data:

- Notebook editing and real model replies on Windows and the server; browser chat history persisted.
- Private Git file sync, Windows editing during a simulated connection loss, reconnection, an explicit concurrent-edit conflict with both versions retained, and its resolution.
- Media integrity matched on the paired devices and remained available locally.
- Rebuilt indexes returned the synthetic note.
- User backups restored into separate empty storage on each device. Records, references, native assistant snapshots and media were verified; credentials were absent.
- The server executed the synthetic schedule; Windows did not. The verification routine was then paused.
- Local startup and restart, server restart and authenticated HTTPS browser access.

Repairs address Windows atomic-write contention and long Git paths, newline-sensitive native history hashes, implicit Git rename detection between independent assistant profiles, assistant snapshot validation before publishing a merge, device credentials in user backups, real Telegram sender restrictions, and Hermes startup diagnostics preceding model JSON. File watchers cover durable knowledge directories instead of recursively watching private backups and temporary Git workspaces.

Validation includes the UI production build, browser-chat and acceptance tests, sync regression tests and Python native-history tests. Desktop and simulated phone screenshots were independently reviewed. The corrected phone layout fills the viewport without horizontal overflow; its existing floating chat control can overlap the bottom card. Physical-phone testing remains outstanding.

Note graph and Lexicon remain unavailable in this alpha. OpenAI replies require a network connection. A separate local copy of the private GitHub notes export was prepared for a later trial, preserving original IDs and case-colliding files via Git objects. It has no automatic sync or configured provider and has not replaced the synthetic paired workspace. A Git notes export is not a complete migration of the live Menerio database or media.

Installed URLs:

- Windows notebook: http://127.0.0.1:47831/dashboard
- Windows chat: http://127.0.0.1:47831/chat
- Server notebook: https://srv1328602.hstgr.cloud:48443/dashboard
- Server chat: https://srv1328602.hstgr.cloud:48443/chat
- Test bot: https://t.me/ClaudeTestOpsDoggy3Bot

Server browser sessions expire after eight hours and after a server restart. The test bot's `/notebook` and `/chat` commands create fresh five-minute, single-use login links for the owner.
