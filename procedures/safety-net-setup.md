# Chapter 17: Back Up Your Hub and Undo Mistakes

I broke my writing guide while writing a chapter about backups. I would have preferred a less convincing demonstration.

I had asked for a tidy-up. The detailed file that helped the assistant write like me came back as this:

```
# My voice

Professional. Friendly. Concise.
```

Three lines. Technically about voice. They could have described almost anyone's writing, which rather defeated the point of keeping a file about mine.

The reason I can enjoy this story is that I had saved an earlier version. I got the guide back, and I want you to have that option before your own tidy-up becomes unexpectedly thorough. We'll keep old versions on your computer for undoing edits, then a separate copy in case the computer itself is lost.

## Review before the first snapshot

Git saves versions of the files you choose, so you can recover good work after a bad edit. Each saved version is a snapshot, which Git calls a commit. Its memory is useful and quite literal: it can also keep a secret you've since deleted. Removing a line today doesn't remove yesterday's saved copy. Before the first snapshot, and again before uploading, review what you're about to keep.

Begin by having the assistant inspect the files on this computer and show you what would enter that history:

```
Before making a first snapshot or uploading anything, inspect this hub locally for files that should not enter its history: credentials, payment details, private conversation archives, personal material I did not intend to copy, and nested projects.

Inspect the existing Git status and history too, if present. Check whether excluded files were already tracked. Do not print secret values into this chat and do not upload file contents to a separate scanning service. Report paths, kinds of information and the proposed action only.

Do not change files or history yet. Show what would be included, what would be excluded and what needs my decision. Explain that this inspection may miss sensitive information.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-17-text-2-20260913)*

Keep the inspection local where possible, and ask for categories of findings rather than the secret contents. There is a catch here: a cloud assistant may send what its file tools read to its model provider. Review especially sensitive files yourself if that exposure would defeat the purpose of checking them.

An ignore rule tells Git to leave out files it isn't already tracking. It has no effect on files already tracked or on their older saved versions. If credentials have reached the history, pause the upload and replace any exposed credentials, then work out how to repair the history. Adding an ignore rule at that point leaves the old copies intact.

## Create local version history

Once you've reviewed which files belong in the history, ask for the first snapshot:

```
Set up local Git version history for this hub, using only the files I approved after the privacy review. Preserve existing history. Exclude the agreed private material and nested projects; verify the exclusions before saving.

Create one snapshot and show its identifier and the files included. Do not upload it or create an automatic job. Explain how I can ask to restore one file without losing unrelated work.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-18-box-3)*

The installer may already have set up Git, so the assistant should preserve any history it finds. Have it list what the new snapshot contains and compare that list with the files you approved. Read the report for work you meant to keep; these are the files you would get back after a mistake.

## Prove that one file can come back

Let's try the undo while the stakes are one sentence in a throwaway file. Leave your real profile out of this experiment:

```
Create backup-practice.txt containing exactly: This is the version I want back.
Save that file in a local Git snapshot without including unrelated changes. Then change only that practice file to: This is the changed version.
Restore backup-practice.txt from the saved snapshot. Compare the restored contents with the original sentence and show the result. Do not alter any other files or upload anything.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-17-text-4-20260913)*

Open the restored file and look for the original sentence. You have now watched a change being undone. The same principle applies to real work: a snapshot saved before an edit gives you a version to return to.

When my writing guide was ruined, I asked in ordinary words for the file to be put back. The assistant answered:

> Restored `profile/voice.md` from commit `865f950` (the last committed version). The three-line stub is gone; the file is back to the full 120-line "Voice rules" document, derived from the writing samples, with sections on sentence length, paragraph shape, openings, closings, directness, bad news, numbers, punctuation, vocabulary, register, self-disclosure, humour, and the "Never list."

I opened the file and found my detailed guide again. I hadn't learned a recovery command or remembered the snapshot code. Asking in ordinary words worked because the earlier version still existed. That was the useful part of my preparation, and considerably better than asking the assistant to remember what my writing used to sound like.

## Make a private copy away from this computer

The history lives on the same drive as your work. It can rescue a file from a bad edit, but it shares the drive's fate if the computer is lost. A separate online copy gives you somewhere to recover that work from.

I use GitHub, a website that can store files together with their Git history. That collection is called a repository. Although GitHub is often used for code, it can keep your hub's notes and instructions too.

If you want to keep your copy there, let the assistant check its access to your GitHub account and guide any necessary sign-in. We'll ask it to make the repository private. Private keeps the files out of public view; GitHub and people you authorise may still have access.

Before uploading, repeat the inclusion and history review. Then ask:

```
Prepare a private GitHub backup named hub-backup for the reviewed hub history. If that name already exists, inspect it and do not replace it.

Before uploading, show the destination, confirm its private visibility, and show the files and history that will leave this computer. Check again for unintended tracked files and sensitive earlier versions. Do not print credential values.

Wait for my approval of that exact upload. After approval, upload the reviewed snapshot, verify the remote snapshot identifier matches, and give me the repository link. Do not create an automatic sync job.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-18-box-5)*

The assistant should confirm that the repository is private and that the uploaded snapshot matches the one you reviewed. It can compare the identifiers itself. Its report and repository link give you a way to inspect the saved work without having to perform that technical check.



[View the illustrated reading edition](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

## Save again when work changes

A backup made once is a backup of that day. The matching starter instructions ask the assistant to fetch changes before working and upload saved changes when it finishes, once you have approved the destination and future uploads. Before enabling that routine, confirm that future uploads may use this private destination with the exclusions you reviewed. Approval of the first upload alone need not grant permission for every later one.

This routine depends on the assistant following its instructions. It is not a service that uploads every file as you type.

After another useful session, ask the assistant to confirm that the private backup includes the work you just finished. Keeping the destination and exclusions clear makes each later save a smaller job.

If you later schedule these saves, ask the assistant to record the job, its destination and its stop control in `procedures.md`. Check that a later snapshot actually arrives. A job listed as active tells you it was set up; a new snapshot tells you it saved something.

## Optional: edit the same files in another app

To browse the hub, start with any editor you already like that opens Markdown files. A plain text editor is enough. Obsidian is a useful choice if you prefer a dedicated notes app. In the version used here, "Open folder as vault" opened the existing hub. *Vault* sounds more impressive than *folder*, but here it means the folder you're opening.

Open the existing hub in the editor. You don't need to make a copy, install community add-ons or add another sync service to read it. Working on the same files spares you the later puzzle of why the assistant can't see the changes you just made.

Before you leave this chapter, check that the practice file came back and, if you chose a remote backup, that the reviewed snapshot arrived there. Credentials left out of Git need their own safe home, such as a password manager. You can then make the next useful edit knowing which version you would ask to get back.
