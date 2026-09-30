# The three questions (Chapter 36)

The entrance exam you give any new hire on their first morning. Open a terminal in your folder,
type `opencode`, and ask these three. Start without the notebook: questions one and two use
only the files in your folder, and question three is for after you have added the notebook.
Answers below are from a real run on 2026-09-02, on the
author's Windows PC, OpenCode 1.18.3 with `openrouter/moonshotai/kimi-k3`, in the book's
illustrator folder (Sam's), with the notebook connected under the name `notebook`, and with an
earlier wording of each question. Unedited apart from marked cuts and the house rule on dashes.

## Before the questions: set up OpenCode

Ask your current assistant to prepare OpenCode for you:

```
Help me test this mission control with OpenCode. Read the current official installation, configuration and provider documentation. Inspect what is already installed before adding anything.

Use a provider account and model I choose after seeing the current access requirements and cost. Do not sign me up, fund an account or copy a credential into chat.

Install the supported version for this computer if needed. Preserve existing configuration and AGENTS.md. Set permission to ask before file edits and shell commands. Inspect combined project and user settings for other active connections; do not silently enable them.

Prepare a secure local sign-in or masked token-entry step and open the assistant in this mission control. Confirm the folder and configured model. Keep schedules unchanged.
```

## Question one: do you know whose house this is?

```
Whose folder is this, what are the house rules you must follow here, and which file would you check for what matters most right now? Answer from what is in the folder. Do not change anything. Name the files you actually read.
```

It read `.`, `profile/about-me.md` and `profile/projects.md`, named the owner, listed the rules
from `AGENTS.md` as a must and a must-never, and then went further than asked:

> `profile/projects.md`, "projects and priorities." Right now it says: (1) the **Little Seasons
> cards for Nadia (Wren Books)**, 20 cards, cards 8 to 12 in revisions running about 4 days
> behind, with all 20 planned by the 28th, and (2) a **rate draft owed to Dana (Bramble Studio)**
> this week. Everything else (Tom's contract, the parked portfolio refresh) is secondary to those two.

It found `AGENTS.md` on its own, because this tool looks for that filename, as Hermes does.
Claude Code looks for `CLAUDE.md`, which is why Chapter 4 leaves a one-line signpost. Same file,
different doorbell.

## Question two: can you run my procedures?

```
Read skills/plan-my-day/SKILL.md. In three sentences, explain what it produces and the limits it follows. Do not execute the skill or change anything. End with exactly: Nothing modified.
```

> This procedure produces a short, timed plan for your day built from your real priorities and
> working hours, with the single most-important task placed first and all small tasks batched
> into one block. It also names one item on your list that you should not do today, with a
> reason why. It refuses to scatter small tasks across the day and refuses to give productivity
> lectures, stopping after the timeline.
>
> Nothing modified.

`git status` afterwards: clean. It read the recipe from the visible `skills/` room, the same room
Hermes reads, and stopped where it was told to stop.

## Question three, optional: can you reach my notebook?

```
Use my notebook tools to look up who Nadia is and how she wants bad news delivered. Report what the notebook returned and identify the notes. Do not read local files for this answer. State any gap and change nothing.
```

It tried six doors into the notebook (`search_contacts`, `search_brain`, `get_contact_context`,
`get_person_notes`, `search_notes`, `get_claims`), then:

> **Who is Nadia?**
> - `search_contacts` and `get_contact_context`: **no contact named Nadia exists.** There is no
>   person record for her.
> ...
> **How does she want bad news delivered?**
> - **Nothing.** No note, no claim, no contact field anywhere in the notebook addresses this.
>
> ... her identity lives in the mission control folder (people.md), which you told me not to read, so I'm
> leaving that gap named rather than filled.

The same two gaps an earlier test with Hermes found, named the same way, and the folder it was
told not to read left unread. That is Chapter 20's habit arriving unprompted, from a model that
has never met you. (If your notebook holds the fictional Nadia notes, expect the answers instead
of the gaps; the shape of the behaviour is the point.)

## What passing means

Three for three means your system is not locked to a vendor. A price rise, a model that gets
worse, a company having a bad year: your answer is a one-line edit to `opencode.json`, not a
migration.

## A note on running it non-interactively

`opencode run "<question>"` answers one question and exits, which is how the answers above were
captured. One of four runs produced no output and was stopped after four minutes; the retry
answered in under a minute. Permission prompts (`"ask"`) do not appear in that mode for
read-only questions, because reading needs no permission.
