# Chapter 8: Save Useful Notes During Your Day

One call ends as you open the notes for the next. The client has changed the budget, moved a date, or finally explained what's bothering her. It's worth keeping. You tell yourself you'll write it down properly later, when the day becomes less like the day you're having.

Save one rough sentence now, before the next call gives you something else to remember. The inbox gives it somewhere to wait; a title and a carefully chosen folder can come later. You are catching the thought while you still have it.

## Name the destination

With Hermes connected to your hub, use “Capture this in my inbox,” followed by the note. This is the practice sentence used in the book; replace it with something you actually want to keep:

```
Capture this in my inbox: Nadia said today the budget for next year's book has doubled. She hinted there could be a second illustrated title in it for me.
```

*[Copy this text](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-9-box-1)*

Nadia is the fictional publishing client from the earlier chapters. In the run on 2 September 2026, the reply was:

> Captured in: inbox/2026-09-02-nadia-book-budget.md

Open the file in the reply and check that it says what you said, with the date and the uncertainty still there. “She hinted” must stay a hint. A promising conversation and an agreed second project are different things. Keep that difference in the note.

The note is a record of what you reported. If a formal offer later gives a different budget, you will want that distinction.

## Capture the changes that affect work

Save the details that would help you pick up the work again: a decision, a promise, a preference or a result. A number earns its place when you know why it matters. Keep enough detail to pick up the thought when you return to it.

“Sending Nadia three options reduced revisions on this job” records who was involved, what you tried and what happened. It gives the assistant more to work with than “Send three options,” while leaving room for another client to want something else entirely.

Do not put passwords or access keys into these notes. Keep only the personal details needed to help with the work.

## Away from the computer

Away from the computer, I recommend starting with a phone note or another place you already trust. Later, paste the notes into Hermes with “Put these in my inbox.” This keeps capture easy while you decide whether connecting another app would help. A thought shouldn't have to wait for you to finish an installation.

An optional alternative is an assistant on a server, a computer that stays on while your laptop is off. It needs its own connection to your messaging app. I tested that route by sending this practice capture through Telegram from my desktop. The reply named a file, which I opened on the server. A second attempt through the server's web interface saved the note too. These were desktop tests; they do not establish that a new phone is already connected.

## File only the captures

When a few notes have accumulated, use the prompt below. It files facts and keeps possible new behaviour rules for you to confirm. A comment such as “I liked that short answer” should not quietly become “Every answer must be short.”

```
Review the capture notes in inbox/. Leave writing-samples/, unresolved import questions, templates and anything that is not clearly a capture untouched.

For each capture, identify its source, date and useful content. Suggest the correct profile file or decisions.md. Keep my reported facts separate from your interpretations. If a new value replaces an old one, update the current entry and preserve the dated change where useful.

Identify explicit instructions about how I want you to behave separately. Leave those in the inbox marked as proposed rules until I confirm them. Do not turn an inferred preference into a rule.

File the clear notes in my words. After checking that the content reached its destination, move those capture files into archives/filed-captures/, preserving their names. Do not delete them. Leave unclear notes in the inbox and ask only about the uncertainty.

Tell me which files changed and where the originals went.
```

*[Copy this text](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-9-box-2)*

This version keeps the filed originals in an archive. In an earlier demonstration, the assistant deleted them after filing because I'd explicitly asked it to. I now prefer being able to read the original words again. Compare one filed note with its archived source and check that it still means the same thing.

## Why “remember” can produce a different result

I first tried the shorter instruction “Remember: Nadia said today the budget for next year's book has doubled.” In the 2 September test, the assistant saved `observations/nadia-book-budget.md`, not an inbox note.

The note had been saved. It just wasn't where I expected it. That's why I now name `inbox/` in the request, then open the file the assistant points to. “Saved” feels reassuring until you go looking for the thing.

`observations/` holds notes the assistant keeps so it can find them later. A note you dictated remains your reported statement even if it lands there.

With another assistant, I tried a save request in four clean folders. I got four reassuring replies and four untouched folders. The notes were in the assistant's own storage on that computer. You can see why I've developed an interest in opening the actual file.

Hermes also has notes in its own application folder, separate from your hub. Ask it to name the destination and open the saved file when testing a new assistant. The familiar word “memory” does not tell you where the note went.

## Keep everything, load only what today needs

My first design made the assistant read a summary of every note at the start of every session. A new note meant a new line. By the time I measured it, the list was 108 lines long, and every line went into every later job, including jobs that had no use for it. Nobody had done anything wrong. The design had been working exactly as I'd asked.

Lauren Contalonis's account of her own system helped me see the decision I'd skipped: keeping a note and loading it into today's work are separate choices. Her “hot,” “warm” and “cold” labels say how readily a note should come back, not how private it is. One sentence stayed with me:

> Not everything safe enough to keep should remain hot enough to influence today's thinking.

The source is her [13 August 2026 article on what an AI system should reach, remember and use](https://www.linkedin.com/pulse/3-expanding-stage-2-what-my-ai-harness-should-reach-use-contalonis-azwpc). In this hub, that means a short briefing at the start of every session and a larger record the assistant searches when a subject comes up. The larger record needs a way to be found, so saving a note and making it searchable belong together.

Rules are different. “I have a dentist appointment” is a fact; “Ask before sending anything in my name” directs future behaviour. Once you confirm a new rule, ask the assistant to save it in `rules/` and refresh the short list in `AGENTS.md` with `hub-compile-rules`. Until then, leave the proposal in the inbox. The rule needs to reach the assistant when work starts, without depending on a search through old notes.

Try this with a note from today. Follow it into its file, then check that its original remains available after filing. Once you've seen that work, you can catch the useful sentence between calls and leave the sorting for later. The day doesn't have to become a quieter day first.
