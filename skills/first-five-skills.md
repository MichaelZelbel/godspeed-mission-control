# The First Five Skills (Chapters 12 to 14)

Five ready-to-use recipes, one per file. The five files themselves sit
beside this one in `skills/` in this kit, so the fastest install is to
copy the ones you want into `skills/` in your own hub, each as its own folder holding a `SKILL.md` with the label on top.
Nothing to paste, nothing to retype.

They are deliberately NOT part of the installer. Your `skills/` folder
arrives holding only the two recipes the hub runs by itself (`next-action`
and `work-item`, Chapter 7), so the first recipe you put there yourself is
one you built, in Chapter 12. Take these when you want them, and not before.

If you would rather not copy files, paste a recipe into a session with
your folder attached and say:

```
Save this as a skill called answer-email-my-way, exactly as written.
```

Every recipe has the same anatomy: the job (what goes in), the shape
(what comes out, numbered), the rules (decided in advance, especially the
never list). Personalize by adding a rule each time an output disappoints
you. The second time you make the same correction, it belongs in the file.

**They fire on their own.** A `SKILL.md` in its own folder under `skills/` steps forward when
what you asked matches its description, without you naming it. Saying the name
still works and is the reliable way to force one: "Answer email my way" runs that
recipe every time. A recipe left loose anywhere else in your hub does neither.

## 1. summarize-for-me

```
You are running my "Summarize for me" skill. When I hand you text with
this skill, summarize it exactly like this:

1. Start with one sentence: what this text is and why it landed on my
   desk.
2. Then at most five bullet points with only the facts that matter.
3. Then one line starting "You need to:" listing anything I personally
   have to do, with dates. If nothing, write "You need to: nothing."
4. End with the one question I should ask next, if any.

Keep the whole thing under 150 words. Plain words, no hype, no emojis.
```

Chapter 13 builds this one from scratch by letting the assistant
interview you, which produces a better recipe than this default. Use this
version if you want the shortcut, and replace it later.

## 2. answer-email-my-way

```
You are running my "Answer email my way" skill. I will give you an email,
sometimes with a note about what I want to say. Draft the reply:

1. If I gave you a note, that is the message; turn it into the reply.
   If not, propose the most sensible reply and mark every guess with
   [CHECK] so I can see it.
2. Write in my voice (`profile/voice.md`). Match the length and
   formality of the email I received, one notch calmer.
3. Answer every question they asked, in their order.
4. If I am saying no to something: early, direct, warm, no groveling.
5. Give me the draft only. No commentary around it.
```

## 3. plan-my-day

```
You are running my "Plan my day" skill. I will tell you what is on
today: meetings, deadlines, loose tasks, how I slept. Build my plan:

1. Start from my real priorities and working hours
   (`profile/projects.md`, `profile/about-me.md`).
2. The one task that matters most goes first, before anything
   reactive.
3. Batch the small stuff into one block; never scatter it.
4. Name one thing on my list I should NOT do today, and say why.
5. Give me a short timeline, then stop. No productivity lectures.
```

## 4. prep-me-for-a-meeting

```
You are running my "Prep me for a meeting" skill. I will tell you who
the meeting is with and what it is about; sometimes I will paste notes
or the invite. Give me a brief:

1. What this meeting is really about, in one sentence.
2. What I know about the people in it (`profile/people.md`); tell me
   plainly if someone is a stranger to you.
3. The three things I should say or ask, in order.
4. The one thing I should not bring up, if any.
5. If a decision is likely: what I would accept, and my fallback.

Under one page. I read this five minutes before the call.
```

## 5. draft-my-update

```
You are running my "Draft my update" skill. I will tell you, in messy
form, what happened since my last update: progress, problems, next
steps. Turn it into my status update:

1. Exactly three sections: Done. Problems, each with what I am doing
   about it. Next.
2. Lead with the item my reader cares about most, not the one I
   finished last.
3. My voice (`profile/voice.md`), one notch more formal. No drama, no
   padding, and no numbers I did not give you.
4. Short enough to read in one minute.
```

## Why the file paths matter

Notice that three of the five name a file in `profile/`. That is not
decoration. A recipe that says "write in my voice" is asking the
assistant to guess; a recipe that says `profile/voice.md` is pointing at
something it can read. The difference shows up the first time you run a
recipe somewhere cold: the one that names its files says what is missing,
and the one that does not invents something plausible. Chapter 16 tests
exactly that.
