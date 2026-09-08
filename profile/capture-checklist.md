# Chapter 9: Save Useful Notes During Your Day

A useful detail often arrives at the end of a call, when you are already thinking about the next one. A client changes a budget. A date moves. You notice what made a difficult exchange easier.

Save one sentence while it is still clear. You do not need to decide its final file.

## Name the destination

With Hermes connected to your hub, use “Capture this in my inbox,” followed by the note. This is the practice sentence used in the book; replace it with something you actually want to keep:

```
Capture this in my inbox: Nadia said today the budget for next year's book has doubled. She hinted there could be a second illustrated title in it for me.
```



Nadia is the fictional publishing client from the earlier chapters. In the recorded run on 2 September 2026, the reply was:

> Captured in: inbox/2026-09-02-nadia-book-budget.md

Open the named file. Check that it contains the actual statement, its date and any uncertainty. “She hinted” should remain a hint, not turn into an agreed second project.

The file records what you reported. It is not independent verification of the budget. That distinction helps later if a formal offer says something different.

## Capture the changes that affect work

Good candidates include a decision, a commitment, a practical preference, a result that worked, or a number you will need again. Keep enough detail to make sense tomorrow.

“Send three options” is incomplete. “Sending Nadia three options reduced revisions on this job” says who, what and how far the evidence reaches. It does not establish a universal rule about clients.

Do not put passwords or access keys into these notes. Review personal details with the same care as the briefing in Chapter 2.

## Away from the computer

Until you connect a phone-accessible route, use a note on your phone or another place you already trust. Later, paste the notes into Hermes with “Put these in my inbox.” Your phone is collecting the text; your computer still has to file it.

Chapter 31 adds a server and Telegram connection. That is optional and is not configured by this chapter. A message cannot be processed by a laptop that is asleep and unavailable.

In a separate recorded server test, I sent the same practice capture through Telegram from my desktop. The reply named the inbox file, and I checked the file on the server. A second attempt through the server's web interface also wrote the note. Those were server tests, not evidence that your phone is connected now.

## File only the captures

When a few notes have accumulated, use:

```
Review the capture notes in inbox/. Leave writing-samples/, unresolved import questions, templates and anything that is not clearly a capture untouched.

For each capture, identify its source, date and useful content. Suggest the correct profile file or decisions.md. Keep my reported facts separate from your interpretations. If a new value replaces an old one, update the current entry and preserve the dated change where useful.

Identify explicit instructions about how I want you to behave separately. Leave those in the inbox marked as proposed rules until I confirm them and the rule-filing workflow is available. Do not turn an inferred preference into a rule. Once that workflow is set up, save each confirmed rule in rules/ and regenerate the short list with hub-compile-rules.

File the clear notes in my words. After checking that the content reached its destination, move those capture files into archives/filed-captures/, preserving their names. Do not delete them. Leave ambiguous notes in the inbox and ask only about the uncertainty.

Tell me which files changed and where the originals went.
```

The earlier demonstration deleted filed captures under an explicit instruction. This revised prompt retains them in an archive so the original wording remains available. Check one destination and one archived original before trusting the filing result.

## Why “remember” can produce a different result

I first tried the shorter instruction “Remember: Nadia said today the budget for next year's book has doubled.” In the 2 September test, the assistant saved `observations/nadia-book-budget.md`, not an inbox note.

The save was real. The destination was different. That is why this chapter names `inbox/` explicitly. The word “saved” is not enough; inspect the file it names.

`observations/` holds notes the assistant keeps for later retrieval. A note you dictated remains your reported statement even if it lands there. The folder name must not convert it into an independent discovery.

In an earlier test with another assistant, I tried a request to save a note in four clean folders. All four replies said the note was saved. All four intended folders stayed untouched; the notes appeared in the assistant's own storage on that computer. That was the observed failure, not proof that every version of that assistant behaves the same way.

Hermes can also keep notes in its own application folder. Chapter 19 reviews those local records. Your hub rules request a shared destination; test the result after changing assistants rather than assuming every tool uses it.

## Keep retrieval separate from keeping

My first memory design put a summary of every note into a page loaded at the start of each session. When I measured it, the page had reached 108 lines. New notes kept adding to a briefing that every job received.

Lauren Contalonis's account of her own system helped me separate keeping information from putting it into today's work. Her “hot,” “warm” and “cold” labels describe how readily information should return, not how private it is. One sentence stayed with me:

> Not everything safe enough to keep should remain hot enough to influence today's thinking.

The source is her [13 August 2026 article on what an AI system should reach, remember and use](https://www.linkedin.com/pulse/3-expanding-stage-2-what-my-ai-harness-should-reach-use-contalonis-azwpc). In this chapter, that distinction becomes a small briefing and a larger record searched when needed.

I changed the design to a short `observations/MEMORY.md` explaining where to search. Detailed notes wait until their subject comes up. This saves unnecessary material in the initial briefing, but it makes useful search essential. A large folder can still become difficult to retrieve from.

Rules are different. A rule hidden in an old note may never be found when it matters. Chapter 17 keeps short behavior rules in the session briefing and their explanations in `rules/`.

Until you reach that setup, keep proposed rules clearly marked in the inbox. Chapter 17 shows how to confirm them, file them and update the short list. A personal fact and an instruction about future behavior need different treatment.

Today's result is modest and useful: one fact captured accurately, one clear note filed, and an original you can find again. You keep the thought; the assistant handles the filing.
