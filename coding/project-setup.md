# Chapter 4: Use Your Mission Control for Coding Projects (Optional)

*If you do not write code, continue with Chapter 5. Nothing later requires this setup.*

Using your mission control for a coding project lets you ask for help with both the code and the work around it. Your assistant can read the project files alongside your notes about what you want to build. You can ask it to fix a problem, check what still needs doing or help choose the next change.

Use Hermes if that is what you installed. Claude Code or Codex can do this work too. The assistant needs access to both your mission control and your project files; no particular code editor is required.

## Ask your assistant to add a project

Use `dev/` inside Mission Control for projects you actively work on. A project you already work on may be stored on GitHub, a website where people keep code and its Git history. A project's files together with their saved history are called a repository.

For this workflow, keeping a copy inside your mission control gives the assistant a place to inspect the code, make changes and run the project's checks. Copying a repository with its saved history is called cloning. We'll put each copy in its own folder inside `dev/`. Other ways of working on GitHub projects exist; this chapter uses the files on your computer.

Ask by project name. For a project named Menerio, the request would be:

```
Clone the Menerio repository into dev/ inside my mission control.
```

Use your own project's name. The assistant should check its access to GitHub, find the repository and check for an existing local copy. If it cannot identify the project, it should ask which account or repository you mean. If sign-in is needed, it should guide you through that step and then continue.

Here, `dev/` means the folder inside your mission control. The assistant should verify that the expected files arrived and tell you the full location, such as the `menerio` folder inside your mission control's `dev` folder. Finding the repository, copying it and checking the result are its work.

## Keep each project's history separate

Putting a project inside `dev/` brings its files within reach of your assistant. The project still has its own Git history. Mission Control has a history too, for your background, instructions and notes.

Suppose a code change breaks your website. You want to restore the earlier code while keeping the notes you wrote today. Separate histories let your assistant do that. There is no need to save another copy of the project's code in Mission Control's history.

The starter kit's `.gitignore` file tells Git to leave the projects inside `dev/` out of Mission Control's history. It keeps `dev/README.md`, the list of projects. Ask the assistant to check that this works:

```
Check that the projects inside dev/ have their own Git histories and are excluded from Mission Control's history. Keep dev/README.md in Mission Control's history. Check a real project file and preview what Mission Control would save. Tell me which file you checked and what you found. Do not delete anything or change existing history.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-4-text-2-20260913)*

The result should name a project file that stays out of Mission Control's history and confirm that the project keeps its own history. If the check fails, ask the assistant to explain and fix the cause before saving more work.

Figure 4.1 shows the arrangement with one example project. Your project will have its own name.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)


Changes your assistant makes here reach GitHub only when it uploads them, an operation Git calls a push. Before removing a project folder, ask the assistant to check for work that has not been uploaded. A fresh copy from GitHub would be missing that work.

## Tell the assistant how to work on this project

A project instruction is an ordinary sentence such as “Run the tests before saying the change is finished.” Another might say “Keep the website's text in British English.” These instructions explain how you want that particular project maintained.

For this setup, keep those sentences in `AGENTS.md` inside the project folder. Mission Control has its own `AGENTS.md` for instructions that apply across your work. A project may already contain instructions; let the assistant read them before adding anything.

Different assistants find instructions differently. Claude Code reads `CLAUDE.md`; a line containing `@AGENTS.md` tells it to read the shared file too. Codex reads `AGENTS.md` directly. Ask the assistant to prepare the right files for the tool you use.

Don't assume a session opened in a project has also read Mission Control's instructions. Codex normally starts its project instruction search at that repository's top folder, while Claude Code also looks in parent folders. Both can receive instructions from your user account. The check below asks what this session received and has it read the shared mission control instructions too. The details are in [Claude Code's instructions guide](https://code.claude.com/docs/en/memory) and [Codex's instructions guide](https://developers.openai.com/codex/guides/agents-md/).

To check your setup, ask:

```
Check the instructions for this project and the AI tool I am using. Show me the instruction files this session received, including any account-wide instructions. If you can only show that a file exists, say so. Read Mission Control's AGENTS.md and this project's instruction files. Explain any conflicting instructions and propose a correction. Keep existing instructions until I approve a change.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-4-text-3-20260913)*

For example, your account-wide instructions might say “Write all documentation in English,” while a project's file says “Write this project's documentation in German.” Decide which you want for that project, then ask the assistant to make the exception explicit. It should not leave you guessing which language it will choose.

I once worked inside a project where the assistant had missed Mission Control's instructions. The file existed, but that session had not read it. That is why the check above asks what the session received. Reading an instruction still does not guarantee the assistant will follow it, so check the work it produces too.

## Ask the question that needs both kinds of evidence

The code can show what has been built; your profile explains why it matters to you. Ask the assistant to compare them when choosing what to work on. This is a review you request, not a check that runs automatically:

```
Read profile/ first. Then look in dev/ and treat every folder there as one of my projects.

For each one, answer in two lines: what it is, and what state it is in, judging only from its files.

Then pick the one project that should get my next free hour, given my priorities in profile/, and say why.

Close with one insight that needed profile/ and the code together, and name the files it came from.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-5-box-6)*

My run found a difference between the product kits named in my priorities and the projects receiving the work. An excerpt from its actual conclusion:

> Your 90-day deliverable names its three kits: "at least 3 polished DevOps kits (e.g. OpenCLAW, Hermes, Paperclip)" by mid-September, which is four weeks away. None of those three exists in `dev/`, and `dev/README.md` defines that folder as exactly the projects being actively worked on. The only trace of them as products is a set of hardcoded Ko-fi links in `dev/zelbel/src/data/siteConfig.ts`, untouched since August 12. Meanwhile the summer's thousands of commits went to the two book companies and their companion kits. So the product line you are actually shipping (teach-it-once-kit, ai-native-company-kit, kit-bootstrap) is no longer the one your priorities file describes. Either the file should be updated to name the real kits, or one of the named three needs to come back into the active folder, because right now the written goal and the work point at different products. Sources: `profile/priorities.md`, `dev/README.md`, `dev/zelbel/src/data/siteConfig.ts`.

The dates and “four weeks away” belong to that run. What bothered me was how easy it was to explain every busy hour while leaving the stated priority untouched. I had evidence of a great deal of work and very little work on the thing I'd said mattered. The choice was mine: change the priority or change the work.

## Two mistakes worth avoiding

I also learned why test files need a throwaway home, a folder you can delete afterwards. One session wrote test output over a project's real `.env` file, then deleted it while cleaning up. The file held a private key. Cleaning up had become the most expensive part of the test. I had to recover the work, and I now protect credential files explicitly. Mission Control's ignore rule cannot stop a tool from overwriting a file inside a project.

Another session searched Mission Control and announced that the manuscript didn't exist. It was sitting inside an ignored project. Many search tools respect ignore files, which had kept the assistant from looking where the book was. A visible project list and a search of that folder solved the mystery. The manuscript had been having a quiet day.

Ask the assistant to save project-specific lessons in that project's `AGENTS.md`. Check the instructions again when you start a fresh session there. When I return to a project, I want the assistant to have the code, my priorities and the lessons from last time. Discovering the same mistake twice is a poor use of an evening.
