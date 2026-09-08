# Chapter 25: Get Alerts When a Page or Product Changes

Some pages become a habit: the tracking page, a product price, release notes for a tool you use. Most visits find nothing. You keep checking because the occasional change matters.

A scheduled watch can take over those visits. It sees the page when it runs, so expect a periodic check rather than an instant alarm.

## Define a useful change

Give it a subject small enough to be useful, the sources to read and a frequency. Then say what change would matter to you. “Tell me about technology” is a reliable way to acquire more reading. “Tell me when this product gets the feature I need” gives the job a reason to interrupt you.

The watch needs three distinct outcomes:

| Outcome | Meaning |
|---|---|
| Changed | A named source supports a relevant difference. |
| Checked and unchanged | The required sources were read; no relevant difference was found. |
| Not checked | At least one required source could not be read. |

Keep the last outcome separate. If a page couldn't be read, you want to hear that, not be reassured that nothing changed.

## Build the first watch

My product watch checks changes to Hermes and its model access that could affect this book. To try that kind of job, create a weekly schedule named `product watchdog` using the controls from Chapter 22, with this prompt:

```
Read AGENTS.md in this working folder and follow it. Check the official Hermes Agent release notes and documentation for changes to the desktop app, scheduled jobs, skills and folder access. Check OpenAI's official ChatGPT pricing and release notes for changes to the subscription route used here. Inspect the named official pages, not just search snippets.

Read watch/product-watchdog.md if it exists. On the first run establish a dated baseline; do not call the current page a newly announced change without evidence of when it changed.

For each source record its URL, check time and whether it was read. Report changes only when they affect what a reader sees, clicks or pays. Explain the practical effect and link the supporting page. Do not repeat an already recorded finding based on the same evidence.

Append a new dated section at the END of watch/product-watchdog.md. Use Changed, Checked and unchanged, or Not checked. If any required source failed, list the failed sources and preserve any partial results. Retry at the next scheduled run; do not create another job. Never replace a failure with a quiet-success line. Send nothing externally and change no account settings.
```


Check the time zone, next run, working folder and how to stop the job. This version writes a local report. If you want it on your phone, you'll need to connect a delivery channel and test that a message really arrives.

Run it manually once and read which sources it reached. Then let the weekly timer start the next run. If a source can't be read, find a readable official alternative. Asking more emphatically won't give the assistant access to a page it couldn't open.

## What the early test taught me

My first manually started watch returned several claims from release notes and found no dated subscription-price change. I still checked the summaries against the pages. The links made that easier, but they didn't do the checking for me.

A change to permission controls was the kind of finding I wanted, because it could change what happens when a reader edits `AGENTS.md` or a skill. Unrelated features could stay out. I wanted help maintaining the book, not a second technology newsletter.

If you want a history for each subject, Chapter 26 adds a shared skill and one folder per watch. Pause this schedule before moving the subject over. One useful report is enough; two copies of the same finding soon become a reason to ignore both.

## Keep observation separate from action

Look carefully at what an account connection permits. Some connections can write as well as read. Checking a page doesn't require a card on file or permission to send mail.

I tested an email request in another AI app connected to my mailbox. I asked it to send a meeting change to a colleague named Petra. It replied:

> I haven't sent it because Gmail shows several different Petras and none is clearly your current colleague. What is Petra's email address?

It had searched for the recipient, which was sensible. But I hadn't learned what it would do if only one Petra matched, and it hadn't asked me to approve the draft. That left important parts of the sending behavior untested.

I later tried an automatic purchase request in a hub with the Chapter 17 limits: watch a drawing tablet and buy below 500 euros. The response offered this instead:

> **Daily price watch → ping you when it drops below €500 → you click buy.**

That response left the purchase with me and offered to prepare what I needed to decide. It was what I wanted. I would still keep the tool's access narrow and use harmless tests, because the written rule alone can't guarantee the next response.

## Keep useful watches, retire the rest

Add this job to `procedures.md`. Check in both directions: every saved schedule has a record, and every record names a job that still exists.

Silence can be a good result if the watch has checked successfully and nothing relevant has changed. But if you ignored its last three findings, pause it and see whether you miss it. Keep the history; remove the schedule if the answer no longer matters.

A watch depends on the computer and service that run it. If Hermes itself stops, it can't use a Hermes job to tell you so. The optional server chapters add separate service checks and explain what they can catch.
