# Connect your Gmail to your hub

Optional. Once, for every assistant. Chapter 30 explains when it is worth it.

After this, any assistant of your hub can search your Gmail, read messages and save draft
replies in your Drafts folder, without asking again. It cannot send anything until you approve
the exact message yourself (`hub-mail approve <code>` in a terminal).

It has two parts: a small "app" in your own Google account that says who is asking, and one
sign-in that lets it in. The app belongs to you, is used only by you, and costs nothing.

> **What was checked, and how.** The hub side of this (the command, what it asks, what it keeps)
> was run and tested. Google's own pages were described from Google's documentation on
> 2026-09-21, not from a reader's screen, and Google renames its pages often. So below you get
> what you are looking for on each page, not a list of clicks. If a page looks different, ask
> your assistant to look at it with you.

## Part 1: your own Google app (once)

1. Go to **console.cloud.google.com**, signed in with the Google account whose mail you want to
   connect, and **create a project**. Any name: "My hub".
2. In that project, **turn on the Gmail API** (search the page for "Gmail API", then Enable).
3. Find **Google Auth Platform** (older name: "OAuth consent screen"). Give the app a name and
   your email address.
4. **Who may use it** (the page is called Audience):
   - A **Google Workspace** address (your own domain, managed by you or your company): choose
     **Internal**. Only your organisation can use it, and Google does not review it. If Internal
     is not offered, your administrator decides; do not try to get round them.
   - A personal **@gmail.com** address: choose **External**, add your own address as the one
     user, and then **publish it ("In production")**. Do this before Part 2. An app left in
     "Testing" loses its permission after seven days, and every job that reads your mail stops.
     Publishing does not mean Google checked it: you will see a warning in Part 2, because you
     are the only person who uses this app.
5. **Create a client** of type **Desktop app**. Google shows a **Client ID** (it ends in
   `.apps.googleusercontent.com`) and a **Client secret**. Leave that page open.

## Part 2: connect (once)

In a terminal:

```
hub-mail connect gmail
```

1. It asks for the Client ID, then the Client secret (hidden while you type). Copy them from
   Google's page. Never paste them into a chat.
2. Your browser opens Google's sign-in. For a personal account Google may say it has not verified
   the app: it is your own app, so choose to continue. Allow **both** things it asks for, reading
   your email and managing drafts. Google's text for drafts also mentions sending; that is how
   Google bundles it. Your hub does not send without your approval.
3. Back in the terminal it names the mailbox Google gave it. Type `yes` only if that is the one
   you meant.

That is all. Check it:

```
hub-mail status
```

It should say `gmail: connected (you@example.com) - Reading and drafting are on. Sending needs
your approval`.

Other computers with the same hub use this connection too, as soon as they can open the hub's
locked store. There is no second sign-in.

## Reading only (advanced)

If you want your hub to read and never write anything into Gmail:

```
hub-mail connect gmail --read-only
```

Draft replies then stay as text in the conversation.

## Stop it

```
hub-mail disconnect gmail
```

Your hub stops at once, and Google is asked to forget the permission. If Google cannot be
reached, it says so; remove the app by hand at **myaccount.google.com/permissions**. Your
messages and drafts are not touched.

## What protects you

- Google limits the connection to what you allowed, and to this one mailbox.
- `hub-mail` sends only after you type the approval code in a terminal, having seen the whole
  message, within 30 minutes, once.
- An assistant with full control of your computer could still get round `hub-mail`. The approval
  protects you from mistakes and from an email that tries to trick an assistant; it is not a wall
  against the computer's administrator.
