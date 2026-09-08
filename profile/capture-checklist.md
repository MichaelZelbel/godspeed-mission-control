# Chapter 9: Save Useful Notes During Your Day

The call ends with one useful detail, just as you are opening the notes for the next call. A budget changed. A date moved. The client finally explained what was bothering her. You mean to write it down properly later.

Give yourself a smaller job: save one sentence now. Deciding where it belongs can wait. That is what the inbox is for.

## Name the destination

With Hermes connected to your hub, use “Capture this in my inbox,” followed by the note. This is the practice sentence used in the book; replace it with something you actually want to keep:

```
Capture this in my inbox: Nadia said today the budget for next year's book has doubled. She hinted there could be a second illustrated title in it for me.
```



Nadia is the fictional publishing client from the earlier chapters. In the recorded run on 2 September 2026, the reply was:

> Captured in: inbox/2026-09-02-nadia-book-budget.md

Open the file named in the reply. It should contain what you actually said, with the date and any uncertainty intact. “She hinted” needs to stay a hint. A promising conversation should not become an agreed second project on the way into a text file.

The note is a record of what you reported. If a formal offer later gives a different budget, you will want that distinction. Saving the sentence did not independently verify the number.

## Capture the changes that affect work

Keep decisions, commitments, useful preferences and results you want to remember. A number can be worth saving too. Give tomorrow's version of you enough detail to know why today's version thought it mattered.

“Send three options” is incomplete. “Sending Nadia three options reduced revisions on this job” says who, what and how far the evidence reaches. It does not establish a universal rule about clients.

Do not put passwords or access keys into these notes. Review personal details with the same care as the briefing in Chapter 2.

## Away from the computer

Away from the computer, use a note on your phone or another place you already trust. Later, paste it into Hermes with “Put these in my inbox.” You can start that habit before connecting anything. The phone keeps the text until your computer can file it.

Chapter 31 offers an optional server and Telegram route if you want the assistant to receive those notes while your laptop is asleep. For now, leave that setup for the day you need it.

I tested the connected route separately by sending this practice capture through Telegram from my desktop. The reply named a file, and I opened it on the server to check. A second attempt through the server's web interface saved the note too. Those tests showed the server route working; your own phone still needs its connection before it can do the same.

## File only the captures

When a few notes have accumulated, use:

```
Review the capture notes in inbox/. Leave writing-samples/, unresolved import questions, templates and anything that is not clearly a capture untouched.

For each capture, identify its source, date and useful content. Suggest the correct profile file or decisions.md. Keep my reported facts separate from your interpretations. If a new value replaces an old one, update the current entry and preserve the dated change where useful.

Identify explicit instructions about how I want you to behave separately. Leave those in the inbox marked as proposed rules until I confirm them and the rule-filing workflow is available. Do not turn an inferred preference into a rule. Once that workflow is set up, save each confirmed rule in rules/ and regenerate the short list with hub-compile-rules.

File the clear notes in my words. After checking that the content reached its destination, move those capture files into archives/filed-captures/, preserving their names. Do not delete them. Leave ambiguous notes in the inbox and ask only about the uncertainty.

Tell me which files changed and where the originals went.
```

This prompt keeps the filed originals in an archive. The earlier demonstration had deleted them after filing, under an explicit instruction. I prefer keeping the original wording available. Check one destination and its archived original to see that the information arrived without changing on the way.

## Why “remember” can produce a different result

I first tried the shorter instruction “Remember: Nadia said today the budget for next year's book has doubled.” In the 2 September test, the assistant saved `observations/nadia-book-budget.md`, not an inbox note.

It really had saved the note, just in a different place. That small difference is why I now name `inbox/` in the request. When the assistant says “saved,” ask where, and open the file.

`observations/` holds notes the assistant keeps for later retrieval. A note you dictated remains your reported statement even if it lands there. The folder name must not convert it into an independent discovery.

With another assistant, I tried a save request in four clean folders. Four reassuring replies, and four untouched folders. The notes had gone into the assistant's own storage on that computer. That tells us what happened in those tests, not what every version will do. It also explains why I have become rather interested in opening the actual file.

Hermes has its own application notes too; we will inspect them in Chapter 19. Your hub rules ask for a shared destination, but a new assistant still needs a save-and-check test. The familiar word “memory” does not tell you where the note went.

## Keep retrieval separate from keeping

My first memory design gave every note a summary on a page loaded at the beginning of every session. By the time I measured it, the page had reached 108 lines. Each new note added something that every later job had to receive, whether it was relevant or not.

Lauren Contalonis's account of her own system helped me separate keeping information from putting it into today's work. Her “hot,” “warm” and “cold” labels describe how readily information should return, not how private it is. One sentence stayed with me:

> Not everything safe enough to keep should remain hot enough to influence today's thinking.

The source is her [13 August 2026 article on what an AI system should reach, remember and use](https://www.linkedin.com/pulse/3-expanding-stage-2-what-my-ai-harness-should-reach-use-contalonis-azwpc). In this chapter, that distinction becomes a small briefing and a larger record searched when needed.

I changed that to a short `observations/MEMORY.md` explaining where to search. The detailed notes wait until their subject comes up. That leaves less to read at the start, although the search now has to earn its keep. A large folder is not useful if you cannot find anything in it.

Rules are different. A rule hidden in an old note may never be found when it matters. Chapter 17 keeps short behavior rules in the session briefing and their explanations in `rules/`.

For now, leave proposed rules clearly marked in the inbox. Chapter 17 will help you confirm and file them. “I have a dentist appointment” and “Ask before sending anything in my name” may arrive in the same afternoon, but only one is an instruction for future behavior.

Try it with one real note. Check what was saved, let the assistant file it, and make sure you can find the original. The thought is yours to keep. The filing does not have to become another evening job.
