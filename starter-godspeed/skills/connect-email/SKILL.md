---
name: connect-email
description: Connect the person's Gmail to the mission control when they say "connect Gmail for me", "connect my email", "can you read my email", "set up email", "Gmail verbinden" or anything like it, and help an assistant or a second computer use a connection that already exists. Checks what already works first, starts the mission control's own setup, and keeps the app password out of the chat. Also for "email stopped working" and "disconnect my Gmail".
---

## What this is

The person wants their assistants to search their Gmail, read a message they pick, and save
draft replies in Gmail's Drafts. The mission control's mail tool (`mc-mail`) does that through Himalaya, a
free mail program, and a Google **app password**: 16 letters Google makes for one program. The
person makes it on Google's page and types it in a window of their own computer (or their
server's own terminal). You do everything else. Email is optional; never push it.

## Rules that do not bend

- **Never ask for the app password, or any password, in the chat.** Not here, not in Telegram.
  If the person pastes one anyway, tell them to remove that app password at
  https://myaccount.google.com/apppasswords and make a new one, and do not use the pasted one.
- **Nothing is sent.** Saving a draft the person asked for needs no extra approval. They press
  Send in Gmail.
- **Gmail is not the mission control's own address.** `account: "mission control"` is a different mailbox. Never answer a
  question about their Gmail from it.
- **Say only what you saw.** "Connected" means `mail_status` said so after a check, not that a
  settings file exists.

## Steps, in this order

1. **Look first.** Call `mail_status` (the `mc-mail` tools). If `gmail` says connected, say so
   in one line, call `mail_status` with `check: true` if they report a problem, and stop.
2. **A connection they already have.** If this assistant already has its own Gmail connector
   (for example Claude's or ChatGPT's own Gmail app) and it does what they asked, say so and use
   it. The mission control's connection is for when they want every assistant, or their server's jobs, to use
   one connection. Do not replace something that works.
3. **No mission control tools here.** If you have no `mc-mail` tools and cannot run commands (a chat in a
   web browser or on a phone), you cannot install anything on their computer. Say so, and offer:
   this app's own Gmail connector if it has one, pasting the email, or asking the assistant on
   their computer to connect Gmail.
4. **Where should email live?** If this conversation runs on their server (remote Hermes,
   Telegram), connect it there: the server's jobs and the Telegram bot then use it, with no
   laptop awake. Otherwise connect this computer. Never buy or set up a server for this.
5. **Say what they will do, before starting.** One short paragraph: a window opens (on a server:
   they type one command in the server's terminal; the terminal in their provider's web page is
   fine); they type their Gmail address; Google's app password page opens and they click Create;
   they type the 16 letters in that window. It needs 2-Step Verification on their Google
   account, and some work or school accounts switch app passwords off.
6. **Start it.** Call `mail_connect`, or run `mc-mail connect gmail-imap` if you run commands.
   On a computer with a screen a window opens and you wait. On a server you get the command to
   hand them, exactly as returned.
7. **Check it.** When they say they are done (or after a few minutes), call `mail_status` with
   `check: true`. Connected: tell them in one line which address, and that assistants opened
   earlier may need restarting once. Not connected: read its `problem` and explain it plainly.
8. **Prove it only if they want.** Offer to show their newest email subject with `mail_search`.
   Never make a test draft they did not ask for.

## When it does not work

- **Google says app passwords are not available for the account:** that account cannot use this
  route. Nothing is broken. Offer pasting, or forwarding to the mission control's own address (Chapter 29).
  Never suggest turning off security settings or opening Google Cloud Console.
- **"Gmail did not accept the app password" later on:** it was removed at Google, or their Google
  password changed (that removes every app password). Start step 5 again.
- **"Gmail could not be reached":** that computer is offline or asleep. Nothing else is wrong.
- **A draft result says `uncertain`:** do not call again. Ask them to look in Drafts; only if it
  is not there, call `mail_draft` again with `after_checking_drafts: true`.
- **An assistant on the same computer has no mail tools:** run `mc-mail setup --check`, which
  starts the tool the way each assistant does, then restart that assistant.
- **Disconnect:** `mc-mail disconnect gmail`, then they remove the app password on Google's
  page. Only removing it at Google stops every copy.

## A second computer, or a desktop app using the server's Gmail

Copying the mission control folder does not copy the Gmail connection; the password stays on the computer
where it was typed. Two ways, and you recommend one:

- **They have a server with Gmail connected on it** (step 4): pair this desktop with it, so the
  password stays on the server. Remote Hermes and the Telegram bot need no pairing: they already
  run on the server. For Claude Desktop, Claude Code or Codex on a laptop:
  1. On the laptop run `mc-mail pair request`. It prints one line starting `mc-mail pair approve`.
  2. The person pastes that whole line into the server's terminal (the one in the provider's web
     page is fine), logged in as the account that runs the mission control (a book server: first
     `sudo -iu ai`). It prints one line starting `mc-mail pair finish`.
  3. The person gives you that line, or pastes it into the laptop's terminal; run it. It checks
     the server is really the server, calls the mail tool once, and registers the laptop's
     assistants. Neither line holds a password.
  The server must be reachable from the laptop: the book's Tailscale network does that. If it is
  not, say which part is missing; never open the server to the internet to fix it.
- **No server**: connect the second computer on its own, with its own app password. Say that it
  is a separate connection, not a Google rule.

Moving an existing laptop connection to the server: connect Gmail on the server first and check
it, then pair the laptop, then `mc-mail disconnect gmail` on the laptop. Never the other order.
