# Chapter 24: Get Alerts When a Page or Product Changes

The tracking page hasn't moved. Neither has the product price, and the release notes still lack the feature you need. You keep returning because eventually one of those pages will have news worth knowing. Until then, you are doing a surprising amount of page-refreshing on behalf of a computer.

Give those visits to a scheduled watch. It reads the page at the times you choose, so a change can wait until the next check to be noticed. Choose a pace that suits the subject, then let the computer make the next visit.

## Define a useful change

Name the subject and its sources, then decide what would be worth hearing about. "Tell me about technology" can fill your morning. "Tell me when this product gets the feature I need" gives the assistant a useful reason to interrupt it. Start weekly for slow product changes; choose a more frequent check when waiting a week would make the finding useless.

Give the watch three possible reports, so a quiet page and an unread page don't become the same answer:

| Outcome | Meaning |
|---|---|
| Changed | A named source supports a relevant difference. |
| Checked and unchanged | The required sources were read; no relevant difference was found. |
| Not checked | At least one required source could not be read. |

Keep a failed page check visible. Silence is useful after the sources have been read and nothing relevant has changed. Without that check, you don't yet know whether there was news.

## Build the first watch

My product watch checks Hermes and its model access for changes that affect this book. A renamed control can make a careful instruction look careless surprisingly quickly. To try it, first ask Hermes to run the prompt below once in your hub. Then ask it to schedule the same prompt weekly, in your time zone, under the name `product watchdog`. Have it save this hub's full working-folder path, keep delivery local and check for an existing job before adding one:

```
Read AGENTS.md in this working folder and follow it. Check the official Hermes Agent release notes and documentation for changes to the desktop app, scheduled jobs, skills and folder access. Check OpenAI's official ChatGPT pricing and release notes for changes to the subscription route used here. Inspect the named official pages, not just search snippets.

Read watch/product-watchdog.md if it exists. On the first run establish a dated baseline; do not call the current page a newly announced change without evidence of when it changed.

For each source record its URL, check time and whether it was read. Report changes only when they affect what a reader sees, clicks or pays. Explain the practical effect and link the supporting page. Do not repeat an already recorded finding based on the same evidence.

Append a new dated section at the END of watch/product-watchdog.md. Use Changed, Checked and unchanged, or Not checked. If any required source failed, list the failed sources and preserve any partial results. Retry at the next scheduled run; do not create another job. Never replace a failure with a quiet-success line. Send nothing externally and change no account settings.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-25-box-1)*

Read the saved job's time zone, next run, working folder and stop control. Start with its local report, which gives you something to inspect without setting up delivery. To receive it on your phone, connect a delivery channel and test that a message actually arrives.

Read which sources the first manual run reached, then let the weekly timer start the next check. If a source won't open, ask the assistant to find a readable official alternative and show you what it used. A replacement source needs to answer the same question.

## What the early test taught me

My first manually started watch returned several claims from release notes and found no dated subscription-price change. I opened the linked pages and compared them with the summaries. The useful test was whether a finding changed something a reader would see, click or pay for.

A change to permission controls passed that test because it could affect someone editing `AGENTS.md` or a skill. Unrelated features could stay out. I wanted help keeping this book accurate. Finding more technology to read was a problem I had already solved rather thoroughly.

Keep the dated checks together so the next run has a comparison. If you move the subject into another research job, pause the old schedule first. Two jobs reading the same page do not make it change sooner.

## Keep observation separate from action

Check what an account connection permits before adding it to a watch. Some connections can write as well as read. Start with the access needed to inspect the page; checking a price requires neither a card on file nor permission to send mail.

I tested an email request in another AI app connected to my mailbox. I asked it to send a meeting change to a colleague named Petra. It replied:

> I haven't sent it because Gmail shows several different Petras and none is clearly your current colleague. What is Petra's email address?

Several Petras are a poor substitute for an approval step. The assistant had looked for a recipient, but the test didn't show what would happen if only one matched. It hadn't asked me to approve a draft either. I still needed to settle both questions before trusting the connection with a real message.

I later tried an automatic purchase request in a hub whose rules required approval before spending: watch a drawing tablet and buy below 500 euros. The response offered this instead:

> **Daily price watch → ping you when it drops below €500 → you click buy.**

The reply kept the useful part, finding the price change, and left the purchase to me. That was the help I wanted. I'd still restrict its tool access and use harmless tests: this reply showed how it handled one request, not how it would handle every future one.

## Keep useful watches, switch off the rest

Add the job to `procedures.md`, then check the list in both directions. Every saved schedule should have a record; every record should name a job that still exists. This catches both the job you forgot to document and the one you thought you had removed.

A quiet watch can be doing exactly what you asked if it checked and found no relevant change. Judge it by what happens when it does speak. If you've ignored its last three findings, pause it and see whether you miss the information. Keep the history, and remove the schedule when the question no longer matters.

Hermes can't report its own failure through a Hermes job that isn't running. If you need notice of that failure, use a separately running monitor that checks for missed results. Until one is configured, silence alone does not prove the watch ran.
