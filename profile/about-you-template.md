# Chapter 3: Organize the Files Your AI Uses

Installation has left you with several new folders and one reviewed briefing. Let the assistant do the filing: separating your projects from your writing preferences helps it find the right background for each job. In Mission Control, ask:

```
Read what-my-ai-knew.md and file the useful parts into profile/about-me.md, profile/people.md, profile/projects.md and profile/voice.md. Use the meaning of the headings, not their exact spelling. Keep unanswered questions in inbox/. Keep the original file. Add the source and today’s date to what you import. Show me what you changed; do not fill gaps by guessing.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-3-text-1-20260913)*

Open the changed files to see where your information went. Your background belongs in `about-me.md`, relevant people in `people.md`, work in `projects.md`, and writing preferences in `voice.md`. The unanswered questions should still be in `inbox/`, with the original briefing kept as the source. You can follow each piece back to the document you reviewed.

A source and a date may look like fussy details until you read a surprising claim about yourself a month from now. Did you confirm it, or did the chatbot write it on a busy afternoon? Those small notes save you from having to guess.

## Three things Mission Control keeps

Mission Control helps your AI in three ways. These are uses of the files, rather than a count of the folders:

**Background** helps the assistant choose a useful answer: your goals, people and preferences. The book also calls this context.

**Skills** are saved instructions for repeated jobs. They say what to read, what to produce and how to judge the result.

**Scheduled jobs** start at an agreed time. They need a working schedule, access to the required material and an awake computer. Writing a job into `procedures.md`, the list of scheduled jobs described in the table below, records the plan; it does not turn the schedule on.

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

## Leave room for later work

The installer creates some folders you have not used yet. Leave them empty until there is something to put in them. The folder names are places to save useful work, not a checklist of chores to complete.

This table is for the day you're trying to find something. The folder names will become familiar as you use them; there is no benefit in memorising the filing system before you've filed anything.

| File or folder | What belongs there |
|---|---|
| `profile/` | Background you choose to maintain about yourself, people, projects and writing |
| `skills/` | One folder per repeated job, with a `SKILL.md` instruction file |
| `procedures.md` | The jobs configured to run, when they start and where results go |
| `AGENTS.md` | The short instructions your assistant reads |
| `rules/` | The full explanation of each behavior rule |
| `decisions.md` | Dated decisions and the reasons for them |
| `inbox/` | Captured notes awaiting filing, plus material explicitly kept there |
| `observations/` | Notes and interpretations the assistant saves, with their sources |
| `prompts/` | Saved prompts and selected conversation records |
| `world/` | People, events and facts Mission Control saves from what you tell it; works without a Menerio account |
| `due/` | Things with deadlines and the dates when reminders should begin |
| `secrets/` | Guidance and a record of access expiry dates; never paste a password into an ordinary note here |
| `dev/` | Coding projects; use this only if you write software |

The installer includes `dev/`, but using it is optional.

The kit instructs your assistant to save useful facts and events in `world/` as you tell it about them. This is work the assistant performs while handling your request; the folder does not collect facts by itself. If you tell it you moved to Bristol in June, it can record the move and your new city, keeping the old city as history. `profile/` is the short briefing your assistant starts with; `world/` is the more detailed record it searches when needed.

If you later connect Menerio, the optional online memory service, you can also copy selected records from there into `world/`. Local records work without that connection.

There are supporting files too. `README.md` explains the folder, `CLAUDE.md` points another AI app to your instructions, and `.mcp.json` holds connection settings. Names beginning with a dot may be hidden in your file browser. Your imported briefing and files you create will appear beside these. The table helps you find a home for work; it is not a list of every file you will ever see.

One supporting file, `.gitignore`, lists files and folders Git should leave out when saving Mission Control's history. Temporary files, for example, usually do not need earlier versions kept. A file left out of the history still exists in your folder; this list does not stop the assistant from reading or changing it.

The installer also supplies small programs and application settings. Those let the assistant find skills and use the kit's helpers. Copying the folders alone does not reproduce that setup.

## Keep the short briefing separate from the larger record

At the start of a job, the setup asks the assistant to read `AGENTS.md`, its short introduction to you and the rules it must follow. It can read the long note about one project when that project comes up. Old conversations can help answer a question, too. They shouldn't start giving fresh orders merely because the assistant opened them.

Keep important rules in the short briefing, with directions to the longer notes. A rule needs to reach the assistant when work starts. If it is buried in old notes, the assistant has to go looking for it; if you load every note, it has to pick it out of every passing thought you've ever saved.

When an answer disagrees with your briefing, check the file and whether this session could read it. Before explaining yourself all over again, find out whether the first explanation arrived.

## Keep `AGENTS.md` small

There is also a limit to how much instruction text Hermes includes. In the version whose source I checked, the default starts at 20,000 characters and can grow with model capacity.

When a file exceeds that allowance, this version keeps the beginning and end and leaves out the middle. A short note tells the assistant about the missing part, so it can read the full file, but it won't always do so. Meanwhile, the file on your computer looks perfectly whole. You and the assistant may be reading different amounts of the same instructions.

My file once reached 20,163 characters. Among the instructions left out was my rule to keep trying when work got difficult. I'd carefully written down the behaviour I wanted, then made the file too long for the assistant to receive it. That was a particularly expensive way to learn about file size.

For the book, I use 19,000 characters as a working ceiling below the default I checked. Ask the assistant to compare the file's length with the allowance in your installed version. A lower configured allowance needs a smaller file.

If it needs more room, ask the assistant to move long examples into reference files while keeping the behaviour instructions in the short briefing. The rules section is generated from the files in `rules/`: the assistant edits the appropriate rule file and runs the kit's `mc-compile-rules` program to refresh the list. You can ask for that in ordinary language. Editing only the generated list would lose your change when the program runs again.

## What plain files give you

You can open these files yourself, change a wrong line and back them up. You can also give them to another assistant without waiting for an export from the old one. You may have to set up connections, sign-ins and schedules again. But the work of explaining who you are and how you like things done stays with you.

`prompts/library/` keeps instructions you paste elsewhere. `skills/` keeps instructions the configured assistant can select while working here. Both persist on disk; they serve different uses.

The Chapter 1 briefing is a short summary of what you chose to keep. If you enabled history collection during installation, supported local conversations may also appear in `prompts/archive/`. Those records need their own review before reuse.
