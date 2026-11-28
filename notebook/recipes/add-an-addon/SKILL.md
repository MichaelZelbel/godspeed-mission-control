---
name: add-an-addon
description: Add an optional add-on when the person asks for one. Use when they say "add the Wingman", "install the video add-on", "add this add-on" with a GitHub link, ask for an add-on to be updated, or say "remove the Wingman". Fetches it, sets it up, checks it and answers in one or two plain sentences saying where to start.
---

## What this is

An add-on is added with one command, never with lines the person types into a terminal. They
say "add the Wingman"; you run the command, and you answer with what it says. Adding an add-on
that is already there updates it, and that asks nothing.

## Run it

With GODSPEED_WORKSPACE set to this installation, run its bundled CLI with the Node it was installed with:

    node notebook/bin/godspeed.mjs addon add <name>

`<name>` is what the add-on is called in the list (`node notebook/bin/godspeed.mjs addon list` prints
it: `wingman`, `video`) or its GitHub repository as `owner/name`. Resolve the person's words to
that yourself. Each line the command prints is JSON with a `state` and a `message`.

- `added`: reply with the `message`, word for word. It says where to start. Never add a command, a path, a step to run, or the words setup or check.
- `problem`: reply with the `message` and nothing more. The add-on is there, but its own check found something.
- `confirm`: the link is not one Godspeed knows. Ask once, in the words of the `message`: "This installs code from owner/name. Add it?" Only when the person answers yes in plain words, run the same command again with `--yes`. Anything else, add nothing.
- `signing_in`: the add-on is private, so GitHub has to let this computer in first. Tell the person to open the `url` and type the `code` there, in one sentence. The command waits and then prints `added` or what went wrong; reply with that. Never ask for a password or a token, and never repeat one you were shown.

When the command fails with an Error line, say in one plain sentence that it did not work and
what the line says. Never try the add-on's own setup by hand.

The notebook's own chat has no shell. There, say: open Settings, find Add-ons, and press Add next to it.

## Removing one

When they ask to remove an add-on, run `node notebook/bin/godspeed.mjs addon remove <name>` with no flag first. It prints `ask` and
changes nothing. Ask the person once, in the words of the `message`: keep what it made, or delete it too, keep first. Then run the
same command again with `--keep`, or with `--delete` only when they plainly say delete. Anything unclear means keep.

- `removed`: reply with the `message`, word for word. Never add a command, a path or a step.
- An Error line: say in one plain sentence that it did not work and what the line says, including "cannot be removed by Godspeed yet". Nothing was deleted; never remove files by hand.

In the notebook's own chat, say: open Settings, find Add-ons, and press Remove next to it.
