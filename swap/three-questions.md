# The three questions (Chapter 36)

The entrance exam you give any new hire on their first morning. Open a terminal in your folder,
type `opencode`, and ask these three. Answers below are from a real run on 2026-09-02, on the
author's Windows PC, OpenCode 1.18.3 with `openrouter/moonshotai/kimi-k3`, in the book's
illustrator folder (Sam's), with the notebook connected under the name `notebook`. Unedited
apart from marked cuts and the house rule on dashes.

## Question one: do you know whose house this is?

```
Whose folder is this, what are the house rules you must follow here,
and which file would you check for what matters most right now?
Answer from what is in the folder. Do not change anything.
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

## Question two: can you reach my notebook?

```
Use my notebook tools to look up who Nadia is and how she wants bad
news delivered. Report what the notebook returned. Do not read any
file in this folder for the answer.
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

The same two gaps Chapter 28's test found with Hermes, named the same way, and the folder it was
told not to read left unread. That is Chapter 20's habit arriving unprompted, from a model that
has never met you. (If your notebook holds the Chapter 28 notes, expect the answers instead of
the gaps; the shape of the behaviour is the point.)

## Question three: can you run my procedures?

```
Read skills/plan-my-day/SKILL.md. In three sentences: what does this
procedure produce, and what does it refuse to do? Change nothing.
End your reply with exactly: Nothing modified.
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

## What passing means

Three for three means your system is not locked to a vendor. A price rise, a model that gets
worse, a company having a bad year: your answer is a one-line edit to `opencode.json`, not a
migration.

## A note on running it non-interactively

`opencode run "<question>"` answers one question and exits, which is how the answers above were
captured. One of four runs produced no output and was stopped after four minutes; the retry
answered in under a minute. Permission prompts (`"ask"`) do not appear in that mode for
read-only questions, because reading needs no permission.
