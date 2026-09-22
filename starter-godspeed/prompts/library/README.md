# Saved prompts

Prompts worth keeping. One file each.

A prompt is a piece of text you paste into an AI to get a job done. This drawer
is where the good ones live, so you never have to write one twice or hunt for it
in an old chat.

**This is not the same thing as `skills/`, and mixing them up causes real
trouble.** One question tells them apart:

> Does my assistant run this itself, here, or do I paste it somewhere else?

If your assistant runs it, it is a skill: a recipe it reads and follows by itself,
with a short header at the top saying what it is for, which is how it picks the
right one without opening all of them. If you paste it somewhere else, it is a
saved prompt and it lives here. A prompt has no such header, and nothing reads
this folder on its own, so your assistant can never browse this drawer and
choose. It is yours to reach for.

Getting it wrong is quiet in both directions. A saved prompt filed in `skills/`
never fires, because there is no job in your folder for it to do. A skill filed
here can never be found at all.

The plain version of the difference:

| | `skills/` | `prompts/library/` |
|---|---|---|
| Who uses it | your assistant, by itself | you, by pasting it somewhere |
| Where it runs | in this folder | anywhere, including tools that cannot see this folder |
| How it is found | the assistant reads the header and picks | you search for it, or ask your assistant to |

The clearest example is a prompt for making a book cover. The tool that makes the
picture cannot see this folder and never will, and your assistant cannot draw a
picture either. So nobody here can run it. It is a saved prompt, and this drawer
is where saved prompts live.

## How a saved prompt is written

One file per prompt, in this folder, shaped like this:

```markdown
---
purpose: one line saying what this prompt is for
source: where it came from, and when
---

The prompt text itself, exactly as it works best.
```

The `purpose` line is the one part worth caring about. It is what shows up when
you search, so write it for the version of you who has forgotten this file exists.

## How to get things in here

- **Ask.** "Save that prompt in my prompts library, call it cover-art, and write
  a purpose line for it."
- **From your old AI.** Chapter 1's export asks your previous assistant for the
  prompts behind the jobs it does for you again and again. Those land here.

## How to get things out

Ask your assistant. "Find the prompt I used for the cover art." It will search
this folder and the log next door in `prompts/archive/`.

Nothing here yet. It fills up as you work.
