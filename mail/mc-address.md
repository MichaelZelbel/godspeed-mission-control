# Give your mission control its own email address

Optional. About ten minutes. Free for light use.

Your mission control gets an address of its own, for example `sam-mission control@agentmail.to`. You forward the
messages you want it to see; it never sees the rest of your mail. The book's Chapter 29 shows
what to do with it.

The service used here is AgentMail, an email provider made for AI assistants. Its free plan
had 3 inboxes, 3,000 emails a month and 100 a day when this was written (September 2026);
check agentmail.to/pricing for today's numbers. Nothing upgrades on its own.

Before you forward anything: if your mail carries other people's private details (clients'
fees, patients' health), check that you may keep them with a company in the United States.
Forward a harmless email first.

## 1. Create the inbox

Sign up at agentmail.to with your own email address. Signing up is yours to do: it accepts
terms in your name. Create one inbox and note its address.

## 2. Create a key that can only read

In AgentMail's console, create an API key for that one inbox and allow it to **read** only
(inbox read and message read). Leave sending, deleting and everything else switched off.
AgentMail then refuses anything else that key tries, whatever program uses it.

If the console only offers a full key, ask your assistant to make the limited one for you with
AgentMail's API, and paste the full key into a terminal prompt, never into a chat. Delete the
full key afterwards if you do not need it.

## 3. Connect it

In a terminal:

```
mc-mail connect agentmail
```

It asks for the address and the key. The key stays hidden while you type and is kept in your
mission control's locked store, where every assistant's copy of `mc-mail` finds it.

## 4. Try it

Forward one ordinary email to the address, wait a minute, and ask your mission control:
"Check the mission control's own inbox and tell me what arrived."

## Stop it

```
mc-mail disconnect agentmail
```

The mission control stops reading at once. The inbox and its mail stay at AgentMail, because services you
signed up with that address may still send there. Delete the key in AgentMail's console too if
you no longer want it.
