# dev/

Home for development projects and Git repositories that live on GitHub as their **own repos**.

## The rule

Each project in here is an independent Git repository. None of them are tracked by the mission control repo, because the mission control's `.gitignore` excludes everything in `dev/` except this README. So you can clone, build, and commit projects here without ever polluting the mission control's history. That affects only what Git saves: your assistant can still read and change the files in here.

## What belongs here

Projects you and your assistant work on **together regularly**. Not an archive, not every repo you own, just the active ones. When a project goes dormant, you can remove the local copy, but first have your assistant check for edits and commits that have not reached GitHub. A fresh clone would not bring those back, and nothing warns you. Your assistant removes a copy only after you say yes.

## How to use

Ask by project name, for example:

```
Clone the Menerio repository into dev/ inside my mission control.
```

Your assistant checks which GitHub account it can reach, finds the repository, and asks which one you mean or guides you through a sign-in only when it has to. It checks for an existing copy first, verifies what arrived and tells you the full path. `AGENTS.md` holds the whole routine.

By hand it is one line:

```bash
cd dev
git clone https://github.com/<you>/<project>.git
```

Each subfolder keeps its own `.git`, its own remote, its own history. The mission control's history never includes them.

## Currently active

_(your assistant lists each project here as it adds one: name, purpose and repository link, so the registry is visible even though the code isn't)_
