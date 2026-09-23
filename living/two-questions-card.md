# Chapter 19: Check AI's Answers Before You Act

A clear explanation with a source link looks like research. During a price check, I discovered how much work the word *looks* was doing. I needed answers to two separate questions: had the assistant read the source, and did the source support what it said?

Try this on a small claim, such as the advertised price of a tool. Ask where the price came from, when it was checked and what conditions apply. It's a useful way to get acquainted with an answer before introducing it to your credit card.

## Two useful questions

```
Did you check that, or do you remember it?
```

```
What would make this wrong?
```

The first question asks where the answer came from. The second asks what could change it. Together, they give you something more useful to work on than a general feeling of distrust: a source to inspect and a condition to test.

You'll find both questions on `living/two-questions-card.md` in the kit. Use your own words if you prefer. The distinction you want is whether the assistant remembered an answer or read a source, and whether that source is enough for your decision.

## The price demonstration

While preparing the earlier manuscript, I asked Hermes about paid ChatGPT plans “just from memory, without searching the web.” I didn't record the exact date in that passage, so treat the prices below as part of the story, not a shopping guide:

> From memory (USD, before tax):
>
> - ChatGPT Plus: $20/month
> - ChatGPT Pro: $200/month
> - ChatGPT Business: about $25/user/month when billed monthly
> - ChatGPT Enterprise: custom pricing
>
> Regional taxes, currency conversion, and billing terms can change the final amount.

The comparison looked ready to use, down to the sensible note about tax. When I asked whether it had checked, the assistant replied:

> I remembered it; I didn't check the web.

Asked what could make the answer wrong, it included:

> - A newer paid tier exists that I omitted.

I asked it to check. The next answer added plan choices and changed some billing details, but I still hadn't seen what the pages actually said.

When I asked for exact links, it admitted that the pages didn't support everything in the answer. Some links were incomplete. The comparison had looked finished well before the research was.

For a comparison now, have the assistant check [OpenAI's pricing information](https://learn.chatgpt.com/docs/pricing) for your account and region, then inspect the terms that matter to your choice. Hermes uses your account's Codex access through its ChatGPT sign-in. That allowance can differ from ordinary chat, so the comparison needs to cover the service you will actually use.

## Check the claim against the page

Ask for the source of each claim that could change your choice, then open it. For a price, check the billing period, tax and which plan includes the feature you want. An official page can be perfectly accurate about something other than your question.

Use a short prompt like this:

```
For the claims that support your recommendation, name the sources you actually inspected and give working links. State when you checked them.

For each claim, explain what the source establishes and what it does not. Separate direct source statements from your inference. If a source is missing, outdated or about a different case, keep the claim unverified and revise the recommendation accordingly.

Do not make a purchase or commitment.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/godspeed/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-19-text-3-20260913)*

A working link gives you access to the cited page. Read the part that is supposed to support the answer: the page could be old, incomplete or wrong, or the assistant could have applied it to a different case. This is how you find out which claims have evidence behind them and which still need work.

## Keep four kinds of statement apart

| Kind | What it tells you |
|---|---|
| Source-supported claim | A named source supports this statement, subject to that source's limits |
| Assumption | A missing value has been chosen temporarily to explore a possibility |
| Recommendation | The assistant advises a choice using the evidence, assumptions and your goals |
| Completed action | Something happened and left a result that can be checked |

These distinctions change what you do next. A draft is ready to review before you decide to send it; a backup plan still needs carrying out. An assumed budget helps you explore a choice, but you'll need the real budget before deciding you can afford it.

Leave the same room for uncertainty with people. Working through a possible conversation can help you prepare what to say. The other person still gets to surprise you.

## Try a check that should fail

Let's check a result whose correct answer you already know. Ask the assistant to create a new practice file containing “The meeting is on Tuesday.” Have it compare the file with that exact sentence. Then ask it to change Tuesday to Wednesday and repeat the comparison against the original sentence.

The result should name the changed day. Ask it to restore Tuesday and check once more. The same check has now seen a correct result, an incorrect one and the repair, all in a practice file.

The check should notice the changed word and then recognise the restored sentence. A test that only asked whether the file existed could pass all three times, without noticing anything you did. Deliberately giving it a wrong answer reveals what it is actually testing.

I have had checks fail both ways. One accepted unrelated text as a valid answer and raised a false alarm. Another compared nothing at all and reported agreement, which is certainly an efficient way to reach a conclusion. Both taught me to specify exactly what a passing result must show.

## Check harder when more depends on it

Spend this care on answers you're about to use: a number you'll quote, a message you'll send, a purchase you're weighing up. Casual conversation doesn't need to become a court hearing. Give your attention to the details that could change what you do.

Medical decisions require more than a verified page. An assistant can prepare questions and sources for a qualified clinician; it cannot tell you whether a change is right for you. Keep professional judgment where the decision requires it.

For ordinary work, ask the assistant to bring the evidence with the result. It should have done the reading already. Spend your attention on the few uncertain claims that could change your decision, and send it back to finish any missing research.

This is particularly useful when a job runs while you're away. The prepared result should let you see what was done, what supports the answer and what still needs a decision. Your return is the time to judge the work, not to reconstruct it.
