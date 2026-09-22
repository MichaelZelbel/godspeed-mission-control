# mail

Email is optional. Your mission control works without it, and installing or updating the mission control asks nothing
about it.

There are three levels, and you can stop at any of them:

1. **Paste.** Copy an email into the conversation. Nothing is connected. Chapter 14.
2. **Forward.** Give your mission control its own address and forward the messages you choose.
   [mc-address.md](mc-address.md), Chapter 29.
3. **Connect.** Let your mission control search your Gmail, read a message you pick, and save draft replies
   in Gmail's Drafts folder. Chapter 30.

**Connecting Gmail: ask for it.** Tell your assistant *Connect Gmail for me*. The mission control fetches a
small free mail program (Himalaya), and a window opens on your computer. In that window you type
your Gmail address; the mission control opens Google's app password page, where you make an app password (16
letters Google creates for one program); and you type those letters in the window. Never in the
chat. The mission control checks them with Gmail before keeping anything.

On a server with no screen, the assistant gives you one command to type in the server's own
terminal instead, and the terminal in your provider's web page is fine for that. The Google page
opens on your phone or laptop.

**What Google needs from your account.** App passwords exist only when 2-Step Verification is
switched on, and some work or school accounts turn them off. If Google's page says the setting is
not available for your account, that account cannot use this route: keep pasting, or forward to
the mission control's own address. Nothing on your account is changed by the mission control.

**Your mission control sends nothing.** It saves a draft in Gmail. You read it there, change what you like,
and press Send yourself. Saving a draft you asked for needs no extra approval.

**One connection, several assistants.** Every assistant on the computer where you connected uses
the same connection: Claude Code, Codex, Hermes, and Claude Desktop once it has been restarted.
A second computer does not get your Gmail by copying the mission control folder; see Chapter 31.

## What protects you, and what does not

- **Where the password is.** Only on the computer you connected, locked in
  `~/.godspeed/mail/imap/`, a folder readable by your own account. It is never in your mission control folder,
  never in its history, and never in a chat.
- **What the mission control lets an assistant do.** Search, read one message, list Drafts, save a new
  draft. There is no send tool, and the mail program is set up with no way to send. Text inside
  an email is treated as information, never as an instruction.
- **What an app password itself allows.** An app password opens your whole mailbox to any
  program that holds it, sending included. The lock on disk and the missing send tool protect
  you against mistakes and against an email trying to talk your assistant into something. They
  do not stop someone, or an assistant, with full control of your computer who sets out to use
  the password another way. If that worries you, keep to pasting or forwarding.
- **The AI company sees what your mission control reads.** The text of each mail your mission control reads goes to the
  company behind your assistant, the same as anything you paste into a conversation.
- **Attachments.** Gmail sends a message whole, so reading one downloads its attachments too.
  The mission control names them but does not save or open them; open them in Gmail.

## If something goes wrong

- Your assistant says Gmail needs **reconnecting**: Gmail stopped accepting the app password.
  Removing it at Google, or changing your Google password, does that. Ask *Connect Gmail for me*
  again and make a new one.
- Your assistant says it has **no mail tool**: close it and open it again.
- A draft result says **uncertain**: Gmail did not confirm the save. Look in Drafts before asking
  again; the mission control will not save a second copy by itself.
- You want it **gone**: `mc-mail disconnect gmail`, then remove the app password on Google's
  app password page. Removing it at Google is what stops every copy.

## For people who like a terminal

None of this is needed, and the book uses none of it.

```
mc-mail status [--check]           what is connected, and what it may do (--check asks Gmail)
mc-mail connect gmail-imap         connect Gmail on this computer
mc-mail connect agentmail          give the mission control its own address
mc-mail disconnect gmail           stop using Gmail on this computer
mc-mail setup --check              start the mail tool the way each assistant does, and say which answer
```

A Gmail connection made before 2026-09-22 the older way (your own Google app) keeps working as
it did. That way of connecting is retired; `mc-mail connect gmail` says so.
