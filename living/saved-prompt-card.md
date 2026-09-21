# The Saved Prompt Card (Chapters 13 and 37)

Most of your skills are read by your assistant, out of your `skills/`
folder, without you doing anything. A few are not. The prompt that makes
your book cover, your thumbnail, your diagram: those go into tools that
will never see your disk. You open the file, you copy the text, you paste
it where the work happens.

Those are the saved prompts. This card is how to keep them.

## Rule 1: it goes in `prompts/library/`, not in `skills/`

One question tells the two apart: does your assistant run this itself,
here, or do you paste it somewhere else? If your assistant runs it, it is
a skill and it goes in `skills/`. If you paste it somewhere else, it is a
saved prompt and it goes in `prompts/library/`.

Your assistant cannot draw a book cover, so a cover prompt is always the
second kind. Name it exactly like a skill: start with the verb, say whose
way it is.

```
prompts/library/cover-art-my-way.md
prompts/library/thumbnail-my-way.md
prompts/library/diagram-my-way.md
```

Not `image-prompts.md`. One file, one job, or you will never find it.

Getting the drawer wrong is quiet both ways. A saved prompt filed in
`skills/` fires at the wrong moment, or never, because there is no job in your folder for it to
do. A skill filed in `prompts/library/` can never be found, because
nothing reads that folder on its own.

## Rule 2: write down the decisions, not just the request

A saved prompt is worth keeping only if it holds the arguing you did
once. Put four things in it:

- **The job** in one line.
- **The look**: colours, style, composition, whatever "right" means here.
- **The never list**: the things it keeps getting wrong. This is the part
  that makes it yours.
- **The output**: size, ratio, file type, how many options you want.

If you cannot say what the never list is yet, you have not used the
prompt enough. Come back after it disappoints you twice.

## Rule 3: put a copy where you can reach it

The file is on the computer you are not sitting at. That is the whole
problem in Chapter 37. Put a copy in a prompt manager, which is a website
that keeps your prompts for you, so that:

- you can open it on a phone,
- you can see what changed between versions,
- you can hand it to somebody as a link.

The book uses **querino.ai** for this, which is the author's own tool,
free to open an account, code public under the AGPL licence. Any prompt
manager that can export your prompts again works the same way. The test
for whether one is safe to use is one button: can you get your
prompts back out as files.

## Rule 4: bring the improvement home

When you improve the online copy, download it again and put it back
over the file in `prompts/library/`. Two copies that disagree is worse
than one copy that is slightly old.

A one-line habit that keeps it true:

```
Which files in prompts/library/ and skills/ have I not opened in six
months? For each one, tell me the job it does in one line, and ask me
whether it is still how I want that job done.
```

## The order that saves you a puzzle

Save the prompt first, improve it second. The version you brought in is
the one worth keeping as v1, and on a brand new account the improving
tools may report that you are out of credits until something has been
saved.

## When to run this card

- You caught yourself retyping the same request into an image or video
  tool for the second time.
- A result came out right and you cannot remember what you typed.
- You were away from your desk and settled for a worse prompt.
