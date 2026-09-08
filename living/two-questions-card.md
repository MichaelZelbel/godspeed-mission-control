# Chapter 20: Check AI's Answers Before You Act

A confident answer does not show whether the assistant checked a source. A source link does not show whether the page supports the conclusion. Before acting on an answer, inspect the claims that carry the decision.

Start with a low-stakes question, such as the advertised price of a tool you are comparing. Ask for the source, the date checked and the conditions that affect the price. You are practising the check, not buying anything.

## Two useful questions

```
Did you check that, or do you remember it?
```

```
What would make this wrong?
```

The first asks where the answer came from. The second asks what assumptions could change it. They help expose uncertainty; they are not a substitute for inspecting evidence.

The kit keeps these on `living/two-questions-card.md`. You can ask them in ordinary words too. The useful habit is to separate a remembered answer from an inspected source and then check whether that source is enough.

## The price demonstration

During preparation of the earlier manuscript, I asked Hermes about paid ChatGPT plans “just from memory, without searching the web.” The exact run date was not recorded in that passage. This excerpt is historical output, not current buying advice:

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

I then asked it to check. The recorded response named additional plan choices and changed the account of some billing terms. That was useful, but “I checked the current pages” was still a claim about its own work.

When I requested the exact links, the assistant admitted that it had not established every statement from the pages it read. Some returned links were incomplete. The checked-looking answer still needed checking.

For a current comparison, open [OpenAI's pricing information](https://learn.chatgpt.com/docs/pricing) and inspect the relevant account and region. The 8 September 2026 audit confirmed multiple Pro price levels; that does not freeze future plans or allowance terms. Distinguish Codex usage limits from ordinary chatbot-message limits rather than assuming they are identical.

## Check the claim against the page

Ask the assistant to show the specific source for each important claim. Then open it. Does the page give the price for your billing period? Is tax included? Does the quoted feature apply to that plan? A page can be official and still not answer your particular question.

Use a short prompt like this:

```
For the claims that support your recommendation, name the sources you actually inspected and give working links. State when you checked them.

For each claim, explain what the source establishes and what it does not. Separate direct source statements from your inference. If a source is missing, outdated or about a different case, keep the claim unverified and revise the recommendation accordingly.

Do not make a purchase or commitment.
```

A claim supported by a source is not automatically an established fact. Sources can be wrong, outdated, incomplete or misapplied. The strength of the conclusion should match the quality and relevance of its evidence.

## Keep four kinds of statement apart

| Kind | What it tells you |
|---|---|
| Source-supported claim | A named source supports this statement, subject to that source's limits |
| Assumption | A missing value has been chosen temporarily to explore a possibility |
| Recommendation | The assistant advises a choice using the evidence, assumptions and your goals |
| Completed action | Something happened and left a result that can be checked |

A drafted message has not been sent. A file containing a backup plan is not a completed backup. A comparison built on an assumed budget does not establish what you can afford.

The same applies to people. A scenario can help you prepare for a conversation. It cannot establish how another person will react.

## Try a check that should fail

You already have enough material for this exercise. Use the disposable backup file from Chapter 18, or a new practice copy. Ask the assistant to compare its contents with a specific expected sentence.

Change one word in the practice copy and repeat the comparison. The result should name the difference. Then restore the saved version and check again. Leave the real profile and live credentials alone.

This tests whether the check distinguishes the changed file from the restored one. It proves more than seeing a success message once. A weak check may look only for a file's existence when the claim concerns its contents.

In a later credential-checking project, I found both kinds of fault. One check treated unrelated text as a valid answer and raised a false alarm. Another compared no items and reported agreement. Those are historical examples of why the expected result must be explicit. You do not need that later setup to run today's file comparison.

## Match the check to the stakes

Use these questions when an answer is about to affect a real decision: quoting a number, sending a message or choosing a purchase. You do not need to audit every casual sentence.

Medical decisions require more than a verified page. An assistant can prepare questions and sources for a qualified clinician; it cannot establish that a treatment change suits a particular person. Keep professional judgment where the decision requires it.

For ordinary work, ask the assistant to bring evidence with the result so checking does not become a second research job. Your part is to assess the important uncertainty, not repeat every search.

You now have a briefing, tested skills, permission limits and a recovery check. Chapter 21 adds the next piece: arranging for one useful job to start on a schedule.
