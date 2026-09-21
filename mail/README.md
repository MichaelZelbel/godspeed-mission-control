# mail

Email is optional. Your hub works without it, and nothing in the installer asks about it.

There are three levels, and you can stop at any of them:

1. **Paste.** Copy an email into the conversation. Nothing is connected. Chapter 14.
2. **Forward.** Give your hub its own address and forward the messages you choose.
   [hub-address.md](hub-address.md), Chapter 29.
3. **Connect.** Let your hub search your Gmail and save draft replies there.
   [gmail-setup.md](gmail-setup.md), Chapter 30.

Both connections are made with one program, `hub-mail`, which the installer puts on your
computer and tells every assistant about. Every assistant uses the same connection: you connect
once, not once per assistant.

```
hub-mail status                     what is connected, and what it may do
hub-mail connect agentmail          give the hub its own address
hub-mail connect gmail              connect your Gmail for reading and drafts
hub-mail pending                    messages waiting for you to approve
hub-mail approve <code>             see one message in full, and send it
hub-mail disconnect gmail           stop, and withdraw the permission at Google
```

## What protects you, and what does not

- **Your email provider enforces some limits itself.** The hub's own address can be given a key
  that can only read. A Gmail connection can only do what you allowed on Google's screen.
- **hub-mail checks the rest.** No assistant can send: it can only save a draft or propose one.
  A message goes out only when you type `hub-mail approve <code>` in a terminal, after seeing the
  whole message, and only once. Text inside an email is treated as information, never as an
  instruction.
- **What it cannot do.** An assistant that has full control of your computer (and many do,
  because you let them run commands) could read the stored connection or change `hub-mail`
  itself. The approval step protects you from mistakes and from an email that tries to talk an
  assistant into sending. It does not protect you from an assistant that sets out to get round
  it. If that worries you, keep to pasting or forwarding.

## If something goes wrong

- `hub-mail status` says **reconnect needed**: Google stopped accepting the connection (you
  withdrew it, changed your password, or the app was still in "Testing"). Run
  `hub-mail connect gmail` again.
- `hub-mail approve` says **this needs you at a terminal**: open a terminal window yourself and
  type it there. An assistant cannot approve for you, on purpose.
- **Not sent: the draft was changed after it was proposed.** Ask the hub to propose it again, so
  you approve the text as it is now.
- **It said "not known whether the message went".** Run the same `hub-mail approve` again. It
  looks in your Sent mail first and never sends a second copy.
