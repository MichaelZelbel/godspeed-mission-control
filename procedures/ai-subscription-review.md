# Optional monthly subscription review (Chapter 24)

## Optional: review what you pay for AI

The weekly review can carry a monthly cost check. Begin with the plans you actually pay for:

```
Read any existing subscription records first. Create or update profile/subscriptions.md with one block per AI plan I confirm: plan name, price and currency, renewal date, source of usage evidence, and status. Keep unknown values marked unknown. Do not duplicate an existing plan or infer that a missing receipt means no usage.
```


Hermes can report recorded usage with:

```
hermes insights --days 30
```

One historical run showed:

> Estimated:   ~$0.50
> Included:    17 session(s) (subscription, no provider invoice)
> Unknown:     4 session(s) (no pricing data)

That number was an estimate for the sessions it had recorded. It couldn't tell me how much allowance I had left unused, or whether a service it hadn't measured cost nothing. A cost review is only as complete as the records behind it.

```
Add an optional monthly subscription section to skills/weekly-review/SKILL.md. Run it only on the first review of the month when profile/subscriptions.md exists.

Read that file and run hermes insights --days 30. Report what the available records cover, known charges and unknown usage. Treat activity in other tools as unmeasured unless their records are available. Distinguish subscription fees from extra usage charges. Recommend a change only with its evidence and tradeoff. Cancel, buy and change nothing. If the command fails, report that failure rather than zero usage.
```
