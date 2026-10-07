---
name: move-godspeed
description: Plan, verify and undo a physical move of one selected Godspeed Mission Control test installation while retaining every copy.
---

# Move Godspeed Mission Control

Use this method when the person explicitly asks to move their selected installation to a different folder. A dry run is harmless; physically moving it requires their request. Do not move their personal original installation during a test. The helper accepts only a workspace containing FULL-ALPHA.md and records/, paired with its actual full-alpha installation.json. Never invent that pointer or change the channel to make a different folder pass.

## Establish ownership and show the plan

Read the actual selected installation.json. Its channel must be full-alpha, dataFormat must be 1, and workspace must name the selected physical folder. The pointer and receipts must live outside both the source and destination. On Windows the installer keeps this pointer under its selected LOCALAPPDATA state folder. Use that installation's bundled Node executable and notebook/bin/godspeed.mjs. Never guess a production server, default SSH alias, personal home, or different installation's pointer.

Set GODSPEED_WORKSPACE to the selected physical source. Run:

```
node PATH_TO_SELECTED_KIT/notebook/bin/godspeed.mjs workspace-move plan NEW_FOLDER ACTUAL_INSTALLATION.json
```

The dry run does not open or modify the record store. Retain its JSON as a new plan file outside the workspace. It lists the exact source, absent destination, file hashes, installation hash, and whether the owned notebook needs stopping. Explain that the original folder will remain as a verified alias, its complete old contents will be retained separately, and undo preserves work made after moving.

Reject existing or nested destinations, linked source contents, stale plans, mismatched pointers and settings. Do not clear a destination, remove a partial copy, prune backups, or change other sessions to get past a refusal. Files, credentials and media copied by the move stay in the person's private installation; never publish them.

## Stop only the selected installation

Use the selected installation's own stop helper and verify its process manifest against the actual executable and server script before stopping it. Also stop only an assistant explicitly owned by that installation. Do not close editors, browser tabs, Codex chats, other assistants, services, company agents or the production VPS. If ownership cannot be verified, report that specific obstacle. Run the move helper from a directory outside the source and destination so its own current directory does not prevent a Windows rename.

## Move and verify

With GODSPEED_WORKSPACE still naming the source:

```
node PATH_TO_SELECTED_KIT/notebook/bin/godspeed.mjs workspace-move apply RETAINED_PLAN.json
```

The helper checks that the reviewed hashes still match, refuses a live selected supervisor, captures a new user-state backup, and restores it to a separate empty copy. It compares the restored records and file bytes before copying the whole private workspace. It compares every copied file, validates record references, retains the original under a unique name, creates an alias at the old path, and updates only the explicit installation pointer. It rebuilds disposable search and reads the resulting pointer, alias and records back. The returned receipt must say verified. All backups, separate restorations, originals and failed copies remain retained.

Launch only this installation through its selected launcher. Verify the notebook opens at the new folder, a known fictional record and its history remain readable, its owner is correct, and a normal edit survives restart. Check owned media and assistant workspace access through the ordinary installed entry. The old alias lets existing paths continue reaching the same workspace; do not rewrite global harness settings. Report any launcher or assistant verification still outstanding rather than claiming the move is complete. macOS acceptance must remain UNVERIFIED until performed on a Mac.

## Undo without losing later work

Select the actual verified external receipt; do not reconstruct one from memory. Set GODSPEED_WORKSPACE to the new physical destination, stop only that installation again, and run from outside both folders:

```
node PATH_TO_SELECTED_KIT/notebook/bin/godspeed.mjs workspace-move undo ACTUAL_MOVE_RECEIPT.json
```

Undo refuses changed aliases or installation settings. It takes and verifies another separate restoration of the current contents, copies the current workspace back, retains the destination, and leaves an alias there. It preserves new and revised knowledge created after the original move. Verify the receipt says undone, the pointer names the restored original location, and later edits remain readable through both paths. Restart and check through the ordinary notebook and assistant entry again. Never delete retained folders or a failed partial copy.

If copying or alias creation fails, keep the actual error and every retained path. Do not silently retry a physical move, replace a folder, fabricate a successful receipt, or accept a source-only check as installed acceptance.


## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
