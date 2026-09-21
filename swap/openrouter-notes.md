# OpenRouter notes (Chapter 36)

OpenRouter (openrouter.ai) sells access to models from many companies through one account and
one key. It is the neutral option for the swap test: no single vendor owns your login.

## Setup

1. Create an account at openrouter.ai and add a few euros of credit.
2. Create an API key (dashboard, then Keys, then Create API Key). Copy it once, store it like a
   password.
3. Put it in your environment as `OPENROUTER_API_KEY`, or run `opencode auth login`, choose
   OpenRouter and paste it.

## Model ids used in the book

Prices move. These were read live from the OpenRouter model list on **2026-07-26** and again on
**2026-09-02** (unchanged for K3, a little lower for the sibling). Check before relying on them.

- `moonshotai/kimi-k3`: the swap-test model. About **$3 per million input tokens** and **$15 per
  million output tokens**.
- `moonshotai/kimi-k2.7-code`: the budget sibling for mechanical work, about **$0.66 per million
  input** and **$3.40 per million output**, so roughly a quarter of the price.

Note the unit: tokens, not words. A million tokens is very roughly 750,000 words of English.

## Cost hygiene

- An agent reads far more than it writes, so the input price is the one that decides your bill.
  Three questions in a small folder cost a few cents. A long working session costs real money.
- The OpenRouter dashboard shows spending live, per request. Look at it after your first session,
  deliberately.
- Set a monthly credit limit on the key when you create it. A leash for the budget, next to the
  leash for the actions.
- If you already pay for a model maker's own subscription, you can point the config straight at
  their endpoint instead and stay inside your flat monthly price. The swap is still a one-line
  model change either way, which is the whole point.
