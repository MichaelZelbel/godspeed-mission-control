# dev/

Home for development projects and Git repositories that live on GitHub as their **own repos**.

## The rule

Each project in here is an independent Git repository. None of them are tracked by Mission Control repo, because Mission Control's `.gitignore` excludes everything in `dev/` except this README. So you can clone, build, and commit projects here without ever polluting Mission Control's history.

## What belongs here

Projects you and your assistant work on **together regularly**. Not an archive, not every repo you own, just the active ones. When a project goes dormant, delete the local copy. It still lives on GitHub, and cloning it back in is one line.

## How to use

Clone a project in:

```bash
cd dev
git clone https://github.com/<you>/<project>.git
```

Each subfolder keeps its own `.git`, its own remote, its own history. Mission Control never sees inside.

## Currently active

_(list projects here as you add them, so the registry is visible even though the code isn't)_
