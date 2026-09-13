# Chapter 28: Connect Your AI Tools to Menerio

A useful note in Menerio, the optional online memory service, should be available when you ask your assistant about it, without employing you to copy it into the conversation. Each AI tool needs its own working connection and permission to read Menerio. Once those are in place, you can ask your question where you're already working.

For example, you might ask for the printing quote you saved in Menerio. The assistant needs permission to search that account and retrieve the note. The connection uses MCP, a standard for giving an AI app tools supplied by another service. You can ask the assistant to configure it. Each app needs its own connection, and retrieved text may enter that app's conversation records.

This connection needs your own Menerio account and a note you can recognise. Before connecting, sign in and save one harmless note, then find it again in Menerio itself. You can use an account you already have; the local hub needs no notebook connection unless you choose this addition.

## Create a key with limited access

In Menerio, open **Settings**, then **API Keys**. Name the key for the tool or computer that will use it. Review the available data categories and enable only what that job needs.

Put the generated key in your password manager. It works like a password, so it belongs outside chats, screenshots and ordinary hub files. Some key pages show the value only once; if this page asks you to copy it now, save it before leaving.

I recommend a separate key for each app. It takes a little more setup, but you can stop one connection without disturbing the others. A shared key is quicker to arrange; cancelling it also stops every connection using it.

The connection address used by the companion setup is:

```
https://mcp.menerio.com
```

## Connect Hermes

Ask the assistant to prepare its Menerio connection:

```
Configure a Menerio connection named notebook using https://mcp.menerio.com. Inspect existing connections first and preserve unrelated settings. Use the installed Hermes connection tools and their current help.

Prepare a secure local token-entry step for me. Do not ask me to paste the key into this conversation, put it in a command argument, or print it. Show where the application will store it without revealing its value.

After I enter it, list and test the connection. Begin with tools that only read. Show whether the server returned tools and report any error. Do not expand permissions to repair a failed test.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-28-text-2-20260913)*

`notebook` is the saved connection name; the service is Menerio. In the tested Hermes setup, the interactive `hermes mcp add` command offered a dedicated authentication prompt and saved the token outside the hub in Hermes' own `.env` file. That file also needs protection.

A successful connection test tells you the server returned tools. My earlier run listed 58; your count can differ. It does not yet tell you that the assistant will choose those tools for your question. We will check that with a note you know is there.

## Optional: connect Claude Code

Claude Code is another AI assistant that can work with files on your computer. If you use it, its connection settings can refer to an environment variable without containing the secret. An environment variable is a named value made available to a running program.

Ask the assistant to prepare the configuration and input method first:

```
Configure a notebook connection for Claude Code in this hub. Inspect the existing .mcp.json and current client help before editing. Keep unrelated connections. Use https://mcp.menerio.com and an Authorization header that refers to ${MENERIO_API_KEY}, never the literal credential.

Show me a masked local input method for this operating system, so I can load the key without putting it in chat or shell history. Launch the client from the environment containing the key and test a read-only connection. Report success or the actual error without printing values. Do not broaden key permissions or enable writes to repair a read failure.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-28-text-3-20260913)*

In the setup checked here, Hermes uses its own connection settings rather than the project's `.mcp.json`. Each computer also needs the real secret available locally; the placeholder in the configuration supplies its name.

A password manager can supply the credential when you set up each machine. Copying configuration that names a key does not copy the key itself.

## Prove which source answered

In a fresh session, ask a question about the harmless notes you put in Menerio. If you used the fictional Nadia notes, use:

```
Use my notebook's tools, and nothing on this computer. Who is Nadia, what is the latest on next year's book, and how does she want bad news delivered? Answer only from what the notebook returns, identify the notes read, and say plainly if you cannot find something. Change nothing.
```

An earlier test returned:

> - Who Nadia is: I cannot find a contact record or further identification for Nadia. The notebook only identifies her through notes about the book and communication preferences.
> - Latest on next year's book: Nadia said today that its budget has doubled. She hinted that there could also be a second illustrated title for you.
> - Bad-news delivery: Give her three options for a setback, not just one. Warn her early; she does not forgive late warnings quickly.

I was pleased by the missing detail. Nadia's role was in Sam's profile, but I had asked for Menerio alone. The assistant stopped at what those notes could tell it. A fuller answer would have been less helpful if it left me believing Menerio held information found somewhere else.

Earlier attempts had searched Hermes' local memory or other folders. I had supplied an empty working folder; Hermes had declined to become forgetful on that account. Naming Menerio and reading the tool calls showed me where it was actually looking.

## Optional: copy selected records

The companion installer can set up copying between the hub and Menerio after you choose the connection. Before turning it on, look through what it proposes to copy and where it plans to keep the key.

| Direction | What the inspected setup copies |
|---|---|
| Hub to Menerio | Observations, skills and individual decisions. |
| Excluded from that upload | `profile/` and `AGENTS.md`. |
| Menerio to hub | Supported people, events and claims into `world/`, marked with their source. |



The inspected installer can arrange copying in two ways: after the assistant saves a version in Git, and during an hourly check. The first uses a **post-commit hook**, an action triggered by that saved version. An ordinary editor save does not trigger it. Have the assistant check which copying triggers were installed; an existing custom hook may have been preserved instead.

Ask the assistant to run the installed copying helper, `hub-notebook-sync --verbose`, and explain what went out, what came back and what failed. The log is at `~/.hub/notebook-sync.log`; `~` means your user folder. A second run with nothing changed lets you check that the same material isn't uploaded twice.

A file marked `origin: menerio` came from Menerio. A later sync may replace it, so make corrections in Menerio itself. Files marked `origin: hub` were written locally by you or your assistant. The copying tool preserves those files. They work independently of the Menerio connection.

It also checks for a response that looks like an unexpected mass removal. That's a useful safeguard, and a reason to keep the recovery copies you arranged earlier.

## Check access and recovery separately

Cancel a key in the service's API Keys page when you no longer want the applications using it to connect. Pausing copying is a different step. Ask the assistant to find and disable its machine schedule and its Git post-commit hook, the action that runs after a saved version. Have it preserve unrelated scheduled work and then verify that neither copying trigger remains active. Canceling a key does not remove old copies.

Inspect the imported records in `world/` for recovery, and export original Menerio notes separately if you need them. A search result shows that you can find a note today. Opening an export lets you check what you'd have if the service were no longer there.

Have the assistant name the source when it uses Menerio information. When a detail is wrong, that name should take you straight to the place to fix it. You shouldn't need a tour of your software to correct one date.
