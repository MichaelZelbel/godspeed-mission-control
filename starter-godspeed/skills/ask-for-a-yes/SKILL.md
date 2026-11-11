---
name: ask-for-a-yes
description: Ask the person for a yes or no when work that runs without them (a routine, a check, a scheduled job) needs their decision. Opens a waiting step with `godspeed-step open`, which they answer with a plain "yes" or "no" in the chat. Never ask them to type a code, an id or a command.
---

## What this is

The person answers in everyday words. A message that asks them to reply "approve" with a code
after it, or to send a code or an id, makes them type something they cannot judge, about work
they never saw. This recipe is the one way to ask instead: a waiting step, answered with a
plain "yes" or "no" (or a button, where the chat has one). Nothing happens before that answer.

## Steps

1. **Ask only what the person can decide.** Something the system can do on its own (a restart,
   a reload, a retry) or that the person already decided is done without asking: see
   `--quietly` and `--subject` below.
2. **Open the step**, one thing per step, every text one plain line in everyday words:

   ```
   godspeed-step open --about "<what it is, from zero, and what happens if they do nothing>" --question "<one plain yes-or-no question>" --yes "<what you do on yes>" --no "<what you do on no>" --by routine:<the routine's name>
   ```

   Add `--quietly restart|reload|retry` when the system may just do it, `--subject <short key>`
   so their earlier answer about the same thing answers it again, and `--outward` when it
   sends, pays, deletes or publishes something. `godspeed-step help` lists every option.
3. **Say its message.** When it prints `"outcome": "asked"`, the message to the person is its
   `message`, word for word (a routine prints it as its result). Any other outcome asked
   nothing: say nothing about it, unless what was done needs one plain sentence. An empty
   `message` means the question already went to them in Telegram, with Yes and No buttons:
   say nothing about it.
4. **Never** put the step's id, a code, a command or "approve"/"reject" with anything after it
   in a message. A routine's words that ask for a code are not sent at all.
