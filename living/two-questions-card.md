# Chapter 20: Check AI's Answers Before You Act

An answer arrives with a confident explanation and a source link. It looks ready to use. Before you act on it, take one more look: did the assistant check the source, and does that source say what the answer claims? Those are two separate questions, as I learned while checking a price.

Practise with something small, such as the advertised price of a tool you're comparing. Ask where the price comes from, when it was checked and what conditions affect it. You aren't buying anything. You're seeing how well the answer survives a closer look.

## Two useful questions

```
Did you check that, or do you remember it?
```

```
What would make this wrong?
```

The first question asks where the answer came from. The second asks what could change it. They give you something to investigate instead of leaving you with a vague feeling that the answer might be wrong.

You'll find them on `living/two-questions-card.md` in the kit, but the wording needn't be ceremonial. Ask in your own words. You want to know if the assistant remembered an answer or read a source, then whether that source is enough for the decision.

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

It looked usable: named plans, amounts and a note about tax. When I asked whether it had checked, it answered:

> I remembered it; I didn't check the web.

Asked what could make the answer wrong, it included:

> - A newer paid tier exists that I omitted.

I asked it to check. The next answer added plan choices and changed some billing details. That sounded like progress. But I still had only its word that it had checked the current pages.

When I asked for exact links, it admitted that the pages didn't establish every statement it had made. Some links were incomplete. I had asked for a checked answer and received another answer I needed to check.

For a comparison now, open [OpenAI's pricing information](https://learn.chatgpt.com/docs/pricing) and check the terms for your account and region. The audit on 8 September 2026 found multiple Pro price levels; plans and allowances may change again. Also keep Codex usage limits separate from ordinary chatbot-message limits. A shared plan name doesn't make those limits identical.

## Check the claim against the page

Ask the assistant to show the specific source for each important claim. Then open it. Does the page give the price for your billing period? Is tax included? Does the quoted feature apply to that plan? A page can be official and still not answer your particular question.

Use a short prompt like this:

```
For the claims that support your recommendation, name the sources you actually inspected and give working links. State when you checked them.

For each claim, explain what the source establishes and what it does not. Separate direct source statements from your inference. If a source is missing, outdated or about a different case, keep the claim unverified and revise the recommendation accordingly.

Do not make a purchase or commitment.
```

A link gives you a place to look. It doesn't settle the matter on its own: a source can be old, incomplete or wrong, or the assistant can apply it to the wrong situation. Let the confidence of the answer grow only as far as the evidence supports it.

## Keep four kinds of statement apart

| Kind | What it tells you |
|---|---|
| Source-supported claim | A named source supports this statement, subject to that source's limits |
| Assumption | A missing value has been chosen temporarily to explore a possibility |
| Recommendation | The assistant advises a choice using the evidence, assumptions and your goals |
| Completed action | Something happened and left a result that can be checked |

A drafted message has not been sent. A file containing a backup plan is not a completed backup. A comparison built on an assumed budget does not establish what you can afford.

That distinction matters with people too. Exploring how a conversation might go can help you prepare. It can't tell you how the other person will actually respond.

## Try a check that should fail

You can practise a different kind of check with a file you already have. Use the disposable backup file from Chapter 18, or make a new practice copy. Ask the assistant to compare its contents with one exact sentence you expect to find.

Change one word in the practice copy and repeat the comparison. The result should name the difference. Then restore the saved version and check again. Leave the real profile and live credentials alone.

Now you've seen whether the check notices the change and then recognises the restoration. That's more revealing than one success message. A check that only asks whether the file exists could cheerfully pass all three versions.

I met both kinds of mistake in a later credential-checking project. One check accepted unrelated text as a valid answer and raised a false alarm. Another compared no items at all and reported agreement. Neither result was useful. Today's small file exercise lets you practise the same lesson without setting up that project: say exactly what a passing result must show.

## Match the check to the stakes

Save this care for answers you're about to use: a number you'll quote, a message you'll send, a purchase you're considering. You don't have to cross-examine every casual sentence to get value from an assistant.

Medical decisions require more than a verified page. An assistant can prepare questions and sources for a qualified clinician; it cannot establish that a treatment change suits a particular person. Keep professional judgment where the decision requires it.

For ordinary work, ask it to bring the evidence with the result. You shouldn't have to repeat its whole research job before using the answer. Focus your attention on the uncertainty that could change your decision.

Once you can judge a result, you can begin to let a job start without you. We'll keep the first scheduled job small enough that you can still see what happened and decide whether it helped.
