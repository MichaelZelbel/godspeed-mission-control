# Chapter 12: Make an AI Skill Work Your Way

The summary skill works. Unfortunately, it also has my habits. Maybe you want the deadline first, dislike my date format, or prefer “Nothing to do” when a newsletter asks nothing of you. Now you get to make it useful for your day.

The interview below gives the assistant a way to draw out those choices, then update the original skill file. Keep that file as the version you improve. If you paste a copy into another app, update the copy there after a change; it has no way to hear about your latest preferences.

## Start from the skill you have

```
Read skills/summarize-for-me/SKILL.md. Interview me one question at a time about the job the summary must do, the shape of the result and the details it must preserve.

Ask about choices the existing file leaves open, including what to do when there is no action and how to show uncertain dates. Use my existing profile where relevant instead of asking me to repeat it.

Show a revised version of this same skill. When I confirm it, update skills/summarize-for-me/SKILL.md. Keep one master skill rather than creating a competing summary skill under another name.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-13-box-1)*

When I tried the interview, its first question gave me something concrete to choose:

> When you ask me to summarize long text, what's the *job* the summary is doing for you? For example:
>
> "So I can decide whether to read the full thing"
>
> "So I can act on it without reading it"
>
> "So I can quote/reference it later"
>
> "So I can explain it to someone else"

Two later questions brought out preferences I hadn't thought to mention:

> **When there's nothing to do** (common with newsletters): should I say "Nothing for you." and stop? Or still give the one-line "what this is" in case you want to file it mentally?

> Also: date format, do you prefer `Fri 31 Jul`, `2026-07-31`, `31.07.`, or "in 5 days"?

Date formats are the sort of preference I rarely think to explain and notice as soon as I see one I dislike. A menu makes the choice easy: I could pick the version I wanted and let the assistant turn it into a rule. A useful interview catches these small irritations before they become part of every answer.

## Read the proposed rules

One rule in the result was:

> **Preserve verbatim, never paraphrase:** Exact prices (`€1,200`, not "about 1k"), dates and times, names of people, companies, products, links, account numbers, references, addresses.

“Preserve verbatim” means keep those details exactly as written. Shortening the surrounding prose is useful; quietly rounding a price or moving a date gives you a different job to deal with. Read the proposed rules for changes like that before accepting them.

The old instruction includes account numbers and addresses because the summary was meant to preserve details faithfully. The choice of what to share with a provider comes first; passwords and access keys belong outside this exercise.

The assistant also explained a section it chose to leave out:

> One note: I dropped a "worth knowing" section I'd been about to add. You picked shape D (one-liner + actions + time-sensitive) and said you only care what you have to do. A "worth knowing" bucket would have re-added the comprehension summary you don't want.

I was glad to lose that section. I'd asked for less to read, and the assistant had nearly added a new reading assignment called “worth knowing.” Leaving it out was a small choice that made the result much closer to what I'd wanted.

## Why saving a file does not make it run

I tried the same gym newsletter in three practice folders. One had no summary instructions. Another had the instructions in a loose Markdown file. The third had `skills/summarize-for-me/SKILL.md` with its header and discovery configured.

The first two gave ordinary summaries. The third used my sections. The loose file had been right there, full of the right words, quietly making no difference. When I named it explicitly, the assistant followed the method. The instructions worked once it knew where to look. For your own check, compare an ordinary request with one that explicitly names the skill. You do not need three practice folders to find out whether Hermes can use your file.

The practical distinction is:

| Where the instructions are | How they become useful |
|---|---|
| A loose file | Ask the assistant to read it, or paste its contents |
| A configured skill | The assistant can select it from its description during a matching task |
| A saved prompt for another tool | Open it and paste it where that work happens |

[View the illustrated reading edition](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/Teach-It-Once.pdf)

Neither file starts work by sitting there. You start the job with a request, or configure a schedule to start it while you are away.

## Retest the revised master

Open a fresh session and try the same newsletter. Read the answer against your revised rules. It no longer needs to resemble my example: getting your preferred date format instead of mine is the point of the exercise. The familiar input makes that change easier to see.

If the interview made a second skill under another name, ask the assistant to compare the files. Choose the version you want it to use, then have it archive the other outside the folders Hermes searches. Two versions can volunteer for the same job, and the one that still carries your old preferences is no less willing to help.

## Use the instructions elsewhere

You can also take these instructions to another tool that accepts pasted text. I tried that with another AI model, Kimi K3, and got the expected sections from the same newsletter. The words travelled well in that test. File access, tool connections and automatic skill discovery still have to be arranged in each tool.

Keep prompts meant for separate image or video tools in `prompts/library/`. Name them for the job, such as `draw-cover-art-my-way.md`. The hub's starter rules treat that folder as reference material to search when asked.

I saved my cover prompt after working through the colours, the arrangement and what to leave out. The next cover could begin with decisions I'd already made, instead of a search through an old chat for the version I remembered liking. Saving the prompt spared me that small archaeological project.

Keep improving that one original. After a meaningful change, give it a familiar job and see whether the answer reflects what you asked for. A useful skill is one you can return to with work to do, without giving the same explanation again.
