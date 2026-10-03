# Subscription register and selected receipts

`mc-subs help` shows installed arguments. `/subs` in normal chat uses the same tool.

The register is plain text, one `## PLAN` block per user-named plan:

```text
## Fictional flat plan
Costs: $20 per month
Renews: The first of each month
Covers: fictional/model
Receipts: none
Status: active
```

This is fictional example data. Do not install it as the user's subscription.

Supported answer fields are costs, renews, covers, receipts, status and last checked. `Costs` understands stated dollar monthly prices and stated annual prices; other currencies or unknown prices remain unpriced, never converted from a guess. Covers is a comma-separated list of actual model IDs. Receipts is claude-code, openrouter, hermes or none. A plan can exist without all answers.

```text
mc-subs set "USER NAMED PLAN" --field costs --value "USER'S EXACT ANSWER"
mc-subs set "USER NAMED PLAN" --field "last checked" --value "ACTUAL DATE"
mc-subs register --json
```

Updates retain other plans and fields, preserve the previous register and refuse multiline field injection or ambiguous duplicate names. Repeating the same answer creates no extra history.

Receipt selection is device-local `.godspeed/subscription-receipts.json`:

```json
{
  "claude_projects": [],
  "openrouter_ledger": "ABSOLUTE PATH TO THE USER-SELECTED LEDGER",
  "hermes_ledger": "ABSOLUTE PATH TO THE USER-SELECTED LEDGER"
}
```

Replace only with explicitly selected actual paths. Claude projects holds selected transcript directories. An empty list scans no personal homes. Missing ledgers are unreadable; they are not zero usage. No credential belongs in this file.

Claude JSONL receipts use assistant messages with model, timestamp and usage token fields. OpenRouter JSONL readings use at/timestamp and usage_total_usd/total_usd cumulative totals; monthly spend is last minus first inside the window, never the sum of running totals. Hermes JSONL uses date/at, in_tokens/input_tokens, out_tokens/output_tokens, calls, profile and optional model split. Unsplittable model use stays explicitly uncertain.

Public pricing comes from OpenRouter's model list, with a dated device cache. User-supplied model-price overrides can be recorded in `profile/subscription-model-prices.json`; never guess them. `--no-network` reads the existing cache and supplied prices only, useful for offline or fictional checks. Missing pricing is UNPRICED.

Dashboard files must stay under `observations/subscription-reviews/` and end in `.md`. Earlier content is retained under its history folder. These files and the register follow the normal durable workspace sync and backup contract. Receipt paths and the price cache remain device-private.
