# mail

Email is optional. Your hub works without it, and the first installation asks nothing about it.

There are three levels, and you can stop at any of them:

1. **Paste.** Copy an email into the conversation. Nothing is connected. Chapter 14.
2. **Forward.** Give your hub its own address and forward the messages you choose.
   [hub-address.md](hub-address.md), Chapter 29.
3. **Connect.** Let your hub search your Gmail, read messages and attachments, and save draft
   replies there. [gmail-setup.md](gmail-setup.md), Chapter 30.

Both connections belong to your hub, not to one assistant. You connect once, and every assistant
you use with your hub shares it.

**Connecting Gmail needs no command.** It is a step of the hub installer: on Windows you click
**Update my hub** in the Start menu and say yes when it asks about Gmail; on macOS and Linux you
paste the installer's one line with `--only gmail` at the end. It opens Google's pages for you,
one at a time, and says what to click on each.

**Your hub sends nothing.** It saves a draft in Gmail. You read it there, change what you like,
and press Send yourself.

## What protects you, and what does not

- **Your email provider enforces some limits itself.** The hub's own address can be given a key
  that can only read. A Gmail connection can only do what you allowed on Google's screen, in the
  one mailbox you allowed.
- **Your hub checks the rest.** No tool your assistant has can send. Text inside an email or an
  attachment is treated as information, never as an instruction. An attachment your assistant
  reads is saved outside your hub folder, so it never ends up in your hub's history.
- **The AI company sees what your hub reads.** The text of each mail your hub reads goes to the
  company behind your assistant, the same as anything you paste into a conversation.
- **What it cannot do.** An assistant that has full control of your computer (and many do,
  because you let them run commands) could misuse the connection: it could read the stored
  connection and talk to Google itself. If that worries you, keep to pasting or forwarding.

## If something goes wrong

- Your assistant says Gmail needs **reconnecting**: Google stopped accepting the connection (you
  removed it, changed your password, or the app was still in "Testing"). Start the Gmail step
  again. It reuses the app you registered and only opens Google's Allow window.
- Your assistant says it has **no mail tool**: close it and open it again.
- You want it **gone**: start the Gmail step again and type `remove`.

## For people who like a terminal

None of this is needed, and the book uses none of it.

```
hub-mail status                     what is connected, and what it may do
hub-mail connect agentmail          give the hub its own address
hub-mail connect gmail --guided     the guided Gmail step, without the installer around it
hub-mail attachment <id> [number]   fetch one attachment to a place outside the hub folder
hub-mail disconnect gmail           stop, and withdraw the permission at Google
hub-mail pending                    an extra: messages you asked to approve at a terminal
hub-mail approve <code>             an extra: see one message in full, and send it once
```
