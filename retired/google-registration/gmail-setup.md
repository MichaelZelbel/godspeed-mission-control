# Connect your Gmail to your hub

Optional. Once, for every assistant. Chapter 30 is the friendly version of this page.

After this, any assistant of your hub can search your Gmail, read messages and their
attachments, and save draft replies in your Drafts folder, without asking again. Your hub sends
nothing. You read the draft in Gmail and press Send yourself.

## Why Google wants a little app

Google only lets registered apps into a mailbox. So you register one small app, in your own
Google account. It belongs to you and nobody else: not to the author of the book, not to any
company in between. It costs nothing, and it takes about ten minutes, once.

## Start the step

You do not type any commands. The hub installer does the walking.

- **Windows:** open the Start menu and click **Update my hub**. When it asks
  `Connect Gmail now?`, type `y` and press Enter.
- **macOS and Linux:** open the Terminal, paste this one line and press Enter.

  ```
  curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/install-hub.sh | bash -s -- --only gmail
  ```

It asks which Gmail address you want to connect. Then it opens one Google page at a time in your
browser and tells you, in one sentence, what to click there. You do that one thing, go back to
the installer's window, and press Enter. Typing `again` opens the page again. Typing `stop`
stops, and nothing is changed.

## What it says at each step

These are the installer's own sentences, so you can read ahead. If Google's page looks different
from a sentence, trust the page, and tell your assistant what you see.

1. Google calls the home of your app a project. In the box "Project name", type My hub, then click Create.
2. A small notice appears at the top right of the page. In it, click Select project.
3. This page is the Gmail API, the door your hub will use. Check that the bar at the top says My hub, then click Enable.
4. This is where your app gets its name. Click Get started.
5. In "App name", type My hub. In "User support email", pick your own address. Click Next.
6. The kind of app depends on your address.
   - An address on your own domain, through Google Workspace: Choose Internal, which means only your own organisation can use this app. Click Next.
   - An address ending in @gmail.com: Choose External, the only choice Google offers a personal address. Click Next.
7. Type your own email address, so Google can write to you about this app. Click Next.
8. Tick the box to agree to Google's user data policy, click Continue, then click Create.
9. Only for an address ending in @gmail.com: Click Publish app, then Confirm. An app left in "Testing" is cancelled by Google after seven days.
10. Under "Application type", choose Desktop app. As the name, type My hub. Click Create.

Then Google shows a small window with two lines, a **Client ID** and a **Client secret**. You
paste each into the installer's window. You will not see what you paste. That is on purpose.
Paste them there and never into a chat with an assistant, because chats are saved.

Last, Google's own window opens and asks whether your app may open your mailbox. Tick every box
and click **Allow**. With an address ending in @gmail.com, Google first warns that it has not
verified the app. That is true: nobody checked it, because it is yours and only you use it.
Click **Advanced**, then the line that names My hub.

Back in the installer's window you see the mailbox Google named, and one question:

```
Google says this mailbox is you@example.com. Is this the one? (yes/no)
```

Type `yes` only if it is. With `no`, the sign-in is withdrawn at Google again and nothing is kept.

If your Workspace does not offer **Internal**, or refuses the app, your administrator decides. Ask
them, in words like: "May I create an Internal app in Google Cloud for my own mailbox, with the
Gmail API, to read mail and save drafts?"

## After it

Close your assistant and open it again. Then ask it something about your mail, in your own words.

Other computers with the same hub use this connection too, as soon as they have the updated
hub. There is no second sign-in, and every assistant on every one of them uses the one connection.

**Attachments.** When your assistant reads an attachment, a copy is saved on your computer in
`.hub/mail/attachments/` in your home folder. That is outside your hub folder on purpose, so a
client's PDF never ends up in your hub's history or on GitHub. Copies are removed after 30 days.
The original stays in Gmail.

## Reading only

At the start the step says: "If your hub should only read and never save drafts, type: read".
Type `read` there. Google is then asked for reading alone, and reply drafts stay as text in the
conversation.

## Stop it

Start the same step again. It says which mailbox is connected. Type `remove`. Your hub stops at
once, and Google is asked to forget the permission. If Google cannot be reached, it says so, and
you can remove **My hub** yourself at **myaccount.google.com/permissions**. Your messages and
drafts are not touched.

Lost a laptop with your hub on it? Remove **My hub** at **myaccount.google.com/permissions** from
any other device. The connection stops working everywhere.

## What protects you, and what does not

- Google limits the connection to what you allowed, and to this one mailbox.
- No tool your assistant has can send. Sending is you, pressing Send in Gmail.
- Text inside an email or an attachment is treated as information, never as an instruction.
- The AI company behind your assistant sees the mails your hub reads, the same as anything you
  paste into a conversation.
- An assistant with full control of your computer could misuse the connection: it could read the
  stored connection and talk to Google itself. If that worries you, keep to pasting or forwarding.

## Extras for people who like a terminal

`hub-mail status` shows what is connected. `hub-mail connect gmail --guided` is the same guided
step without the installer around it. `hub-mail disconnect gmail` stops it. And if you would
rather approve a send at a terminal than press Send in Gmail, ask your assistant to propose the
draft for sending: it gives you a code, and `hub-mail approve <code>` shows the whole message and
sends it once, only if you type the code back. The book does not use any of these.
