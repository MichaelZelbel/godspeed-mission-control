# Bring your context with you (Chapters 1 and 3)

Your folder should not start empty. Whatever AI you have been using already knows things
about you: who you work with, what you are building, the corrections you have made a hundred
times. That is yours. This gets it out.

Do this before anything else in the book. Ten minutes per tool.

There is no button for it, in any product. No AI lets another program read its memory. So the
route is: one prompt in, one answer out, and your assistant files the answer. That is not a
workaround, it is the only route that exists, and it works with every tool.

## Step 1: paste this into the AI you have been using

Use the tool you have actually been talking to. If that is ChatGPT on your phone, use that.
If it is Claude on the web, open the project you have been working in, because its memory is
per project.

````markdown
I am moving to a new assistant that keeps its memory as plain files I
own. Export everything you know about me so nothing is lost.

Use your memory of me, your saved instructions about me, and our past
conversations. Do not invent anything. If you are unsure whether
something is true, leave it out.

Give me the result as a markdown file I can download. If you cannot
make a file, put the whole thing in one code block instead.

Never include a password, a PIN, a card number, a key or a recovery
code. If a fact only makes sense with one of those in it, leave the
whole fact out.

Output ONLY the document below, using exactly these headings, in this
order. Under each heading, put ONE item per line, starting with "- ".
Each line must make sense on its own to someone who has never met me,
so no "he" or "that project", and no reference to this chat. If a
heading has nothing, write "- none".

If you run out of room before the end, stop at the end of a section,
say which section you stopped at, and wait. I will ask you to continue.

## WHO I AM
My work, my role, my situation, where I live, my languages. Facts
about me as a person.

## PEOPLE
One line per person who matters to my work or life: who they are to
me, and the one thing worth remembering about working with them.
First names only.

## PROJECTS
One line per project or ongoing piece of work: what it is, where it
stands, what it is for. Include ones that are paused or finished, and
say so.

## PREFERENCES AND RULES
One line per instruction I have given you about HOW to work with me.
Include everything I have corrected you on more than once, everything
I told you never to do, and how I like answers shaped. This is the
most valuable section, so be thorough.

## DECISIONS
One line per real decision I made and stuck with, with roughly when,
and why I made it.

## REUSABLE PROMPTS
Think of the jobs you do for me again and again. For each one, write
the prompt that does that job best. Mark it "recalled" if it is close
to something I actually sent you, or "reconstructed" if you are
writing it fresh from what the job needs. Use exactly this shape:

### <short name for the prompt>
what it is for: <one line>
recalled or reconstructed: <one word>
--- prompt begins ---
<the full prompt text, exactly as it works best>
--- prompt ends ---

## THINGS I SHOULD CHECK
Anything you are including that might be out of date or that you are
unsure about, one per line, so I can verify it rather than trust it.
````

Four things in that prompt are there for a reason, and taking any of them out costs you.

**It asks for a file.** A long answer copied out of a chat window loses its formatting and
usually loses its last third. A downloaded file does not.

**It says what to do when it runs long.** Without that line, a tool that runs out of room
stops mid-sentence and says nothing, and you never find out what is missing.

**It asks for prompts by job, not by count.** "The prompts I asked for more than once" cannot
be counted by a model, so it under-delivers. Asking for the prompt behind each repeated job
gets you the real list, and the recalled-or-reconstructed mark tells you which ones to trust.

**It bans keys.** Your old AI will hand over whatever it has, and nothing sits between it and
your disk except this instruction. The prompt is the first guard, and Step 3 is the second.

## Step 2: save the whole answer, unedited

Download the file, or copy the whole answer into a new plain text file. Save it at the top
of your `godspeed` folder, called `what-my-ai-knew.md`.

Save it whole, before you change a word. It is the dated record of everything one company's
AI believed about you, and you only get to take that photograph once.

## Step 3: read it before you keep it

This is the one moment where you see, on a single page, everything a company's AI believes
about you. Some of it will be wrong. Some of it will be from a job you left. Some of it you
will not want on your disk at all.

Three passes, and Chapter 1 of the book walks all three:

1. **Fix what is wrong.** Out of date, half true, or from a life you no longer live.
2. **Cut what should never travel.** Keys first, if the prompt let any through. Then other
   people's private things. Then anything about you that you would rather not keep.
3. **Cut the padding.** Flattery, repetition, and three vague lines that should be one.

The PREFERENCES AND RULES section is the valuable one. Those lines are years of corrections
you would otherwise make all over again with a new assistant.

## Step 4: file it into your folder

Chapter 2 of the book is where the rooms exist. Then open a session with your folder
attached and say:

```
Read what-my-ai-knew.md at the top of this folder. File it into my folder:
- WHO I AM goes into profile/about-me.md
- PEOPLE goes into profile/people.md
- PROJECTS goes into profile/projects.md
- PREFERENCES AND RULES: add each one to AGENTS.md under a heading
  "What ChatGPT learned about how I work"
- DECISIONS: append each to decisions.md with its date
- REUSABLE PROMPTS: one file each in prompts/library/, with the purpose
  line and where it came from
- THINGS I SHOULD CHECK: put in inbox/ as one checklist file

Mark every line you file with where it came from and today's date, so I can
always tell an imported guess from something I told you myself. Do not invent
anything that is not in that file. Show me what you did, and delete nothing.
Leave what-my-ai-knew.md where it is.
```

That last paragraph is the part people skip and regret. An imported line is a claim another
company's AI made about you. A line you wrote yourself is a fact. Keep them apart, or in six
months you will not be able to tell which is which.

Note where the prompts go. `prompts/library/` is not `skills/`. A skill is a recipe your
assistant reads and runs by itself; a saved prompt is text you paste into a tool that may
never see this folder. Filing one as the other is how a folder ends up full of skills that
never fire.

## Do it again later

You will keep using that other AI. Phone, browser, whatever it is. Once a month, run the
same prompt again and file only what is new. You do not have to remember: Chapter 24's
weekly review asks you on the first review of each month, and `procedures/outside-ai-check.md`
is that branch as a file.
