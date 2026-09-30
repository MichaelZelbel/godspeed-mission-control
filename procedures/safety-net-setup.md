# The Safety Net (Chapter 18)

Four prompts and one small piece of homework. You type no commands at any
point.

Two nets, and they fail in opposite directions:

- **Undo** catches the ordinary disaster, a good file quietly turning into
  a worse file.
- **A copy that is not on this laptop** catches the coffee, the theft, and
  the drive that stops one morning.

You want both.

## Before the first snapshot: check what goes in

Version history remembers everything you save in it, including a secret you
deleted later. So first, in a session with your folder attached, have the
assistant look at what would go in:

```
Before making a first snapshot or uploading anything, inspect this mission control locally for files that should not enter its history: credentials, payment details, private conversation archives, personal material I did not intend to copy, and nested projects.

Inspect the existing Git status and history too, if present. Check whether excluded files were already tracked. Do not print secret values into this chat and do not upload file contents to a separate scanning service. Report paths, kinds of information and the proposed action only.

Do not change files or history yet. Show what would be included, what would be excluded and what needs my decision. Explain that this inspection may miss sensitive information.
```

*[Copy prompt](https://querino.ai/prompts/privacy-check-before-the-first-snapshot)*

If a key has already reached the history, stop there: replace the key first. An
ignore rule added now does not remove the old copies.

## Net one: version history

Once you have decided what belongs in it:

```
Set up local Git version history for this mission control, using only the files I approved after the privacy review. Preserve existing history. Exclude the agreed private material and nested projects; verify the exclusions before saving.

Create one snapshot and show its identifier and the files included. Do not upload it or create an automatic job. Explain how I can ask to restore one file without losing unrelated work.
```

*[Copy prompt](https://querino.ai/prompts/version-history-setup)*

If it asks before running a command, say yes.

What you should see afterwards: a first snapshot of the files you approved,
and a hidden `.git` folder you never have to open. Nothing runs on its own
yet, so there is nothing for `procedures.md`.

## Prove one file can come back

Try the undo once on a throwaway file, never your real profile:

```
Create backup-practice.txt containing exactly: This is the version I want back.
Save that file in a local Git snapshot without including unrelated changes. Then change only that practice file to: This is the changed version.
Restore backup-practice.txt from the saved snapshot. Compare the restored contents with the original sentence and show the result. Do not alter any other files or upload anything.
```

*[Copy prompt](https://querino.ai/prompts/prove-one-file-can-come-back)*

Open the file and look for the original sentence.

## Using the undo, in plain words

You never type a command again. You say things like:

```
Show me what has changed since yesterday.
```

```
Undo the last change to skills/plan-my-day/SKILL.md.
```

```
I let something overwrite profile/voice.md and it is now three useless
lines. Put it back the way it was, and show me what you restored.
```

```
Roll the whole folder back to the initial version.
```

## Your homework, the only step you cannot hand over

GitHub needs an account and signing in to your own account is not
something an assistant can do for you. Make one at **github.com**. Free.
That is the whole of it.

## Net two: a private copy off this laptop

Run the check from the start of this card once more, then:

```
Prepare a private GitHub backup named godspeed-backup for the reviewed mission control history. If that name already exists, inspect it and do not replace it.

Before uploading, show the destination, confirm its private visibility, and show the files and history that will leave this computer. Check again for unintended tracked files and sensitive earlier versions. Do not print credential values.

Wait for my approval of that exact upload. After approval, upload the reviewed snapshot, verify the remote snapshot identifier matches, and give me the repository link. Do not create an automatic sync job.
```

*[Copy prompt](https://querino.ai/prompts/private-github-backup)*

Then open the web address it gives you and check with your own eyes that
the word **Private** sits next to the name. Once, today. Your folder holds
your people, your projects and your voice; this is not the place to assume.

A backup made once is a backup of last Tuesday. Keep it current with:

```
Save a snapshot and push the private copy.
```

Or ask for it at the end of every session, which makes it a procedure, and
procedures get a row in `procedures.md`. Before you do, say plainly that later
uploads may go to this private copy with the exclusions you reviewed: your yes
to the first upload is not a yes to every later one.

## Net three, optional: a window onto the same folder

Your system is plain text files, so any program that reads text files can
be a second window onto it. **Obsidian** (obsidian.md, free for personal
use) is the one worth trying.

On its start screen, under **Create local vault**, choose:

> **Open folder as vault**
> Choose an existing folder of Markdown files.

Pick your folder. That is the entire setup. A "vault" is a folder.

Two notes. Obsidian starts in **Restricted mode**, with community add-ons
off; leave it that way. And this net is genuinely optional. Nothing later
in the book needs it.

## What you can now survive

- A file quietly ruined: undone in a sentence.
- A change you regret from three days ago: undone in a sentence.
- A laptop that dies on a Tuesday: everything is one download away, and
  it is private.
- A tidy-up that went too far: the never-delete line stopped it, and the
  snapshot catches whatever the rules did not.
