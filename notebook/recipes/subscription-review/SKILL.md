---
name: subscription-review
description: Review the user's chosen AI subscriptions from actual receipts, prices and capacity evidence. Report what each cost and carried, ask at most one missing question and raise at most one new arithmetic flag. Never rank models from benchmarks or cancel a plan.
---

# What your AI subscriptions carried

## The result

Answer two questions with arithmetic: what each chosen subscription cost, and what actual work flowed through it. A model name does not tell you its price, subscription tier, quality or remaining capacity. The user's verdict stays theirs.

Read the workspace rules and profile/voice.md. Read `reference/register-and-receipts.md` before first use. The register is `profile/subscriptions.md`; the complete receipt meter is installed as `mc-subs`. In normal notebook chat or Personal commands, the equivalent entry point is `/subs` followed by the same arguments. Neither needs Michael's private engine, company ledgers or default personal assistant homes.

## Turning it on

The user chooses this review once. Search their notebook and selected records before asking what they pay. Do not copy another person's subscriptions, prices or receipts.

1. Create only the blocks for plans they actually name. Use `mc-subs set "PLAN" --field costs --value "THE USER'S EXACT ANSWER"` and the other fields in the reference. An unknown price stays unknown. One answer per run is enough; a partly filled register works.
2. Select only the receipt sources they authorize on this device, in `.godspeed/subscription-receipts.json`. The reference gives the actual formats. No sources selected means unreadable, not zero. Do not scan default assistant homes or company ledgers.
3. Run `mc-subs meter` and read its actual result. A command's successful exit does not mean every plan was measured; inspect each row's availability, source and price status.
4. If the user wants ongoing review, select the `subscription-review` routine in the notebook. Set its calendar time, every weekday and chosen day of month in Routine times. Day 31 uses the last day of a shorter month, then returns to 31. Confirm the actual saved job, next run, enabled state and schedule owner. A prose register entry is not an installed schedule. Preserve their deliberately paused routines.

Do not conduct an onboarding interview. Ask only the next missing answer that changes the page.

## The monthly run

Run these installed commands, in order:

```text
mc-subs meter
mc-subs dashboard --out observations/subscription-reviews/YYYY-MM-DD.md
mc-subs ask
```

Use the actual local date. The saved dashboard remains in the workspace and its earlier content is retained on replacement. Read it back. A scheduled selected subscription-review routine also saves its measured result and dashboard as a notebook note; identical evidence stays quiet. Do not create an additional per-plan scheduler.

For a requested manual review, file the page into the notebook with `capture_note`, retaining its receipt sources and date. Use the actual returned local note link. Do not publish a public page or send a message without exact approval. The notebook or chosen delivery connector is the shared delivery route.

The user-facing result carries, in order:

1. One link to the actual saved result.
2. At most two short lines of what changed since the previous review. Read that review first; do not re-describe an unchanged page.
3. The one question returned by `mc-subs ask`, when it returns one. Preserve the question's meaning and ask nothing else.
4. At most one flag that clears every test below. Leave its verdict blank for the user.

When an answer arrives, write only that answer into the named register block using `mc-subs set`. Read `mc-subs register --json` back and confirm the changed field once. The register is the single home for these answers; earlier versions are retained in `profile/subscription-history/`. Do not maintain a parallel list of plan prices in chat memory.

## All four tests for a flag

1. It is arithmetic from actual receipts, not a forecast. A price paid for an unused chosen plan can qualify; a benchmark saying one model beats another cannot.
2. This run's receipts support it. A plan the meter could not read is labelled unreadable, never flagged as unused. A missing price stays UNPRICED; list-price valuation is not actual spending.
3. It names one specific user decision: consider cancelling this plan, downgrading that plan, or moving this job onto a plan already carrying it. Prepare evidence, cost and the proposed exact change; do not execute it.
4. It is new. Read prior reviews and unanswered flags. Do not repeat last month's unanswered suggestion.

If any test fails, there is no flag. A month without one is a correct month. Do not manufacture a recommendation to fill the scheduled report.

## When asked whether to switch

Answer from the user's actual work in three parts:

1. What their current plan carried, from the meter, with unreadable and unpriced rows named plainly.
2. What capacity limits actually stopped, if records contain that evidence. Flat subscription tokens are not extra dollars; a cap can still stop work. A rolling-window cap and a monthly allowance are different facts. Do not infer downtime or a tier from a model list, balance or context window.
3. Offer a comparison on ten real jobs from their own month if they still want one. Both chosen providers run the same selected jobs and the user judges. Run it only after they request it. Never substitute public benchmarks, run an unasked paid comparison or invent evaluation results.

## Refusals that preserve the result

- Unreadable never becomes $0.00. Distinguish a measured zero from missing receipts.
- Unknown model pricing stays UNPRICED. Public list-price valuation and actual metered dollars remain separate columns.
- Ask at most one question in a run. Do not repeat an unanswered flag.
- Never cancel, downgrade, buy, subscribe, switch an account or add a fallback provider from this recipe. Exact outward-action approval belongs to the user.
- Never infer the subscription tier from which models an API lists. Use a supplied actual billing record or ask the single missing question.
- Keep selected receipt paths and credentials device-private. Receipt configuration contains paths, not API keys. The public price lookup sends no receipt text or credentials.
- Label cached price sources with their date, failed reads with their actual limitation, and a proposed switch with an unfilled user verdict.
- Confirm the saved dashboard, register answer and selected monthly schedule from real state. Recipe inclusion is not proof those actions happened.


## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
