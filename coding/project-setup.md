# Chapter 4: Use Your Hub for Coding Projects (Optional)

*If you do not write code, continue with Chapter 5. Nothing later requires this setup.*

An assistant can spend a whole evening helping you write good code for the wrong project. Every small problem gets solved; the thing you said mattered still waits. Giving it your priorities as well as your code lets it notice that gap before you spend another evening there.

Use Hermes if that is what you installed. If you already use Claude Code, including in VS Code, or Codex, keep using it. VS Code is the editor; Claude Code or Codex is the assistant working inside it. What matters here is that your assistant can read and change the hub and project files on your computer.

## Ask your assistant to add a project

Use `dev/` inside the hub for projects you actively work on. A project you already work on may be stored on GitHub, a website where people keep code and its Git history. A project's files together with their saved history are called a repository.

To work on that project here, your assistant needs a copy on this computer. Copying the repository, including its history, is called cloning. The copy goes into its own folder inside `dev/`.

Ask your assistant to do it. Paste the repository's GitHub link after this sentence:

```
Clone this repository into dev/ inside my hub.
```

*[Copy this text](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-4-text-1-20260913)*

If your assistant already knows the project, its name is enough. If the name could mean two repositories, it should ask which one. Here, `dev/` means the folder inside your hub. You do not need to assemble a Git command yourself.

The assistant should tell you where it put the project. Open that folder and check that its files are there. If GitHub needs you to sign in, complete that step and let the assistant continue.

## Keep each project's history separate

Putting a project inside `dev/` brings its files within reach of your assistant. The project still has its own Git history. The hub has a history too, for your background, instructions and notes.

Suppose a code change breaks your website. You want to restore the earlier code while keeping the notes you wrote today. Separate histories let your assistant do that. There is no need to save another copy of the project's code in the hub's history.

The starter kit's `.gitignore` file tells Git to leave the projects inside `dev/` out of the hub's history. It keeps `dev/README.md`, the list of projects. Ask the assistant to check that this works:

```
Check that the projects inside dev/ have their own Git histories and are excluded from the hub's history. Keep dev/README.md in the hub's history. Check a real project file and preview what the hub would save. Tell me which file you checked and what you found. Do not delete anything or change existing history.
```

*[Copy this text](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-4-text-2-20260913)*

The result should name a project file that stays out of the hub's history and confirm that the project keeps its own history. If the check fails, ask the assistant to explain and fix the cause before saving more work.

Figure 4.1 shows the arrangement with one example project. Your project will have its own name.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)


Cloning brings a copy from GitHub to your computer. Changes your assistant makes here reach GitHub only when it uploads them, an operation Git calls a push. Before removing a project folder, ask the assistant to check for work that has not been uploaded. A fresh copy from GitHub would be missing that work.

## Tell the assistant how to work on this project

A project instruction is an ordinary sentence such as “Run the tests before saying the change is finished.” Another might say “Keep the website's text in British English.” These instructions explain how you want that particular project maintained.

For this setup, put those sentences in `AGENTS.md` inside the project folder. The hub has its own `AGENTS.md` for instructions that apply across your work. A project may already contain instructions; ask the assistant to read them before adding anything. There is no need to invent a separate `rules.md` file.

Different assistants find instructions differently. Claude Code reads `CLAUDE.md`; a line containing `@AGENTS.md` tells it to read the shared file too. Codex reads `AGENTS.md` directly. Ask the assistant to prepare the right files for the tool you use.

More than one instruction file can affect a session. Claude Code can read instructions from your user account, parent folders such as the hub, and the project. Codex also has account-wide instructions, but its project search normally starts at the top of the project's own repository. A separate project inside `dev/` therefore does not automatically inherit the hub's file in Codex. An unrelated sibling project's instructions are not part of either search merely because they sit nearby. These details come from [Claude Code's instructions guide](https://code.claude.com/docs/en/memory) and [Codex's instructions guide](https://developers.openai.com/codex/guides/agents-md/).

To check your setup, ask:

```
Check the instructions for this project and the AI tool I am using. Show me the instruction files this session received, including any account-wide instructions. If you can only show that a file exists, say so. Read the hub's AGENTS.md and this project's instruction files. Explain any conflicting instructions and propose a correction. Keep existing instructions until I approve a change.
```

*[Copy this text](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-4-text-3-20260913)*

For example, your account-wide instructions might say “Write all documentation in English,” while a project's file says “Write this project's documentation in German.” Decide which you want for that project, then ask the assistant to make the exception explicit. It should not leave you guessing which language it will choose.

In Claude Code, `/context` shows which instruction files loaded; `/memory` lets you open and edit them. Those are Claude Code commands. In another tool, ask the assistant how to inspect its active instructions rather than copying those commands.

I once worked inside a project where the assistant had missed the hub's instructions. The file existed, but that session had not read it. That is why the check above asks what the session received. Reading an instruction still does not guarantee the assistant will follow it, so check the work it produces too.

## Ask the question that needs both kinds of evidence

```
Read profile/ first. Then look in dev/ and treat every folder there as one of my projects.

For each one, answer in two lines: what it is, and what state it is in, judging only from its files.

Then pick the one project that should get my next free hour, given my priorities in profile/, and say why.

Close with one insight that needed profile/ and the code together, and name the files it came from.
```

*[Copy this text](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-5-box-6)*

My run found a difference between the product kits named in my priorities and the projects receiving the work. An excerpt from its actual conclusion:

> Your 90-day deliverable names its three kits: "at least 3 polished DevOps kits (e.g. OpenCLAW, Hermes, Paperclip)" by mid-September, which is four weeks away. None of those three exists in `dev/`, and `dev/README.md` defines that folder as exactly the projects being actively worked on. The only trace of them as products is a set of hardcoded Ko-fi links in `dev/zelbel/src/data/siteConfig.ts`, untouched since August 12. Meanwhile the summer's thousands of commits went to the two book companies and their companion kits. So the product line you are actually shipping (teach-it-once-kit, ai-native-company-kit, kit-bootstrap) is no longer the one your priorities file describes. Either the file should be updated to name the real kits, or one of the named three needs to come back into the active folder, because right now the written goal and the work point at different products. Sources: `profile/priorities.md`, `dev/README.md`, `dev/zelbel/src/data/siteConfig.ts`.

The dates and “four weeks away” belong to that run. What bothered me was how easy it was to explain every busy hour while leaving the stated priority untouched. I had evidence of a great deal of work and very little work on the thing I'd said mattered. The choice was mine: change the priority or change the work.

## Two mistakes worth avoiding

I also learned why test files need a throwaway home, a folder you can delete afterwards. One session wrote test output over a project's real `.env` file, then deleted it while cleaning up. The file held a private key. Cleaning up had become the most expensive part of the test. I had to recover the work, and I now protect credential files explicitly. The hub's ignore rule cannot stop a tool from overwriting a file inside a project.

Another session searched the hub and announced that the manuscript didn't exist. It was sitting inside an ignored project. Many search tools respect ignore files, which had kept the assistant from looking where the book was. A visible project list and a search of that folder solved the mystery. The manuscript had been having a quiet day.

Ask the assistant to save project-specific lessons in that project's `AGENTS.md`. Check the instructions again when you start a fresh session there. When I return to a project, I want the assistant to have the code, my priorities and the lessons from last time. Discovering the same mistake twice is a poor use of an evening.
