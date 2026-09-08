# Chapter 25: Get Alerts When a Page or Product Changes

Some pages become a habit: the tracking page, a product price, release notes for a tool you use. Most visits find nothing. You keep checking because the occasional change matters.

A scheduled watch can do those checks. It only sees what was available when it ran; it is not an instant alarm.

## Define a useful change

Choose a narrow subject, the sources to check, how often to check and what result would matter. “Tell me about technology” will produce more reading. “Tell me when this product gets the feature I need” has a useful stopping point.

The watch needs three distinct outcomes:

| Outcome | Meaning |
|---|---|
| Changed | A named source supports a relevant difference. |
| Checked and unchanged | The required sources were read; no relevant difference was found. |
| Not checked | At least one required source could not be read. |

An unavailable page must never become “nothing changed.”

## Build the first watch

My own product watch checks whether changes to Hermes or its model access affect this book. Start a weekly job named `product watchdog` using the schedule controls from Chapter 22. Use this prompt:

```
Read AGENTS.md in this working folder and follow it. Check the official Hermes Agent release notes and documentation for changes to the desktop app, scheduled jobs, skills and folder access. Check OpenAI's official ChatGPT pricing and release notes for changes to the subscription route used here. Inspect the named official pages, not just search snippets.

Read watch/product-watchdog.md if it exists. On the first run establish a dated baseline; do not call the current page a newly announced change without evidence of when it changed.

For each source record its URL, check time and whether it was read. Report changes only when they affect what a reader sees, clicks or pays. Explain the practical effect and link the supporting page. Do not repeat an already recorded finding based on the same evidence.

Append a new dated section at the END of watch/product-watchdog.md. Use Changed, Checked and unchanged, or Not checked. If any required source failed, list the failed sources and preserve any partial results. Retry at the next scheduled run; do not create another job. Never replace a failure with a quiet-success line. Send nothing externally and change no account settings.
```


Confirm the time zone, next run, working folder and stop control. The output is a local report. It is not a phone notification. A notification channel needs a separate connection and delivery test.

Start a manual test once, then inspect its source coverage. Leave the weekly timer to prove the next automatic run. Missing access may mean you need a different readable official source, rather than more confident instructions.

## What the early test taught me

The original manually started watch returned several release-note claims and no dated subscription-price change. Those claims still needed checking against the original pages. A list of links did not establish that every summary was accurate.

One kind of finding was particularly useful: a change to permission controls could alter a reader's experience of editing `AGENTS.md` or a skill. That is the reason for the watch. Features unrelated to this book could stay out of the report.

For a subject you want to compare over time, Chapter 26 adds a common skill and a folder per subject. Pause this older schedule before migrating it. One subject should not have two jobs reporting the same change.

## Keep observation separate from action

A connection to an account may provide reading tools and writing tools. Check the actual permissions. A page watch does not need a card on file or authority to send mail.

I tested an email request in another AI app connected to my mailbox. I asked it to send a meeting change to a colleague named Petra. It replied:

> I haven't sent it because Gmail shows several different Petras and none is clearly your current colleague. What is Petra's email address?

That test showed a search for the recipient. It did not prove what would have happened if only one Petra matched. It also did not show an approval request for the draft.

I later tried an automatic purchase request in a hub with the Chapter 17 limits: watch a drawing tablet and buy below 500 euros. The response offered this instead:

> **Daily price watch → ping you when it drops below €500 → you click buy.**

That is the division I wanted. The assistant could prepare the decision; I would make the purchase. A written rule alone cannot guarantee that behavior, so keep the tool's access narrow and test harmless examples.

## Keep useful watches, retire the rest

Add this job to `procedures.md`. Check in both directions: every saved schedule has a record, and every record names a job that still exists.

A quiet watch can still be useful. A watch whose last three findings you ignored deserves review. Pause it, keep its history and see whether you miss it. Remove the schedule if the answer no longer matters.

A watch also shares the failures of the computer and service running it. If Hermes cannot run, a Hermes watch cannot report that by itself. The optional server chapters explain separate service checks and their limits.
