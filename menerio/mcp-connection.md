# Chapter 29: Connect Your AI Tools to the Same Notebook

Once you've saved a useful note online, you'll probably want the assistant to use it too. Knowing the notebook exists isn't enough. Each AI tool needs a working connection and permission to read the note.

We use MCP, a standard way for an AI application to call another service's tools. It lets the assistant ask the notebook for information. You still set it up in each application, and whatever comes back may become part of that application's conversation records.

## Create a key with limited access

In Menerio, open **Settings**, then **API Keys**. Name the key for the tool or computer that will use it. Review the available data categories and enable only what that job needs.

Put the generated key in your password manager. It works like a password, so keep it out of chats, screenshots and ordinary hub files. If the page says to copy it now, take that seriously: it may not show the value again.

A separate key for each application gives you a useful choice later: stop one connection without stopping the others. Sharing a key means less setup, but canceling it stops every connection using it. Other valid keys keep working.

The connection address used by the companion setup is:

```
https://mcp.menerio.com
```

## Connect Hermes

In a terminal, enter:

```
hermes mcp add notebook --url https://mcp.menerio.com
```

Call the connection `notebook`. Hermes already has local memory files, and calling everything “memory” makes it harder to say which one you want it to search.

When the command asks whether authentication is required, choose yes. Paste the credential into the dedicated token prompt, not into the command line. Hermes stores this connection in its own configuration; protect that location too.

Then check it:

```
hermes mcp list
hermes mcp test notebook
```

Look for the notebook address in the list and discovered tools in the test result. An earlier run found 58 tools; your version may find a different number. You have checked that the connection works. Next, we'll see whether the assistant uses it for the right question.

Take a look at which tools can read and which can write. Where your version supports it, `hermes mcp configure notebook` lets you limit the enabled tools. Begin with reading if that is the job you have in mind.

## Optional: connect Claude Code

If you use the developer tool from Chapter 5, its project configuration can refer to an environment variable without containing the secret. An environment variable is a named value made available to a running program.

Ask the assistant to prepare the configuration and input method first:

```
Configure a notebook connection for Claude Code in this hub. Inspect the existing .mcp.json and current client help before editing. Keep unrelated connections. Use https://mcp.menerio.com and an Authorization header that refers to ${MENERIO_API_KEY}, never the literal credential.

Show me a masked local input method for this operating system, so I can load the key without putting it in chat or shell history. Launch the client from the environment containing the key and test a read-only connection. Report success or the actual error without printing values. Do not broaden key permissions or enable writes to repair a read failure.
```

In the setup checked for this book, Hermes doesn't read the project's `.mcp.json`. Its own connection needs its own configuration. And a placeholder copied to another computer is still a placeholder: you must make the actual secret available there too.

You can do that with a password manager and a separate connection on each machine. Chapter 30 offers an encrypted credential store if you want another way to manage it.

## Prove which source answered

In a fresh session, ask a question about the harmless notes you put in the notebook. If you used the fictional Nadia notes, use:

```
Use my notebook's tools, and nothing on this computer. Who is Nadia, what is the latest on next year's book, and how does she want bad news delivered? Answer only from what the notebook returns, identify the notes read, and say plainly if you cannot find something. Change nothing.
```


An earlier test returned:

> - Who Nadia is: I cannot find a contact record or further identification for Nadia. The notebook only identifies her through notes about the book and communication preferences.
> - Latest on next year's book: Nadia said today that its budget has doubled. She hinted that there could also be a second illustrated title for you.
> - Bad-news delivery: Give her three options for a setback, not just one. Warn her early; she does not forgive late warnings quickly.

That missing detail was a useful result. The notebook didn't establish Nadia's role, although Sam's separate profile did. I had deliberately asked it to use only the notebook, so I wanted it to stop at what those notes could support.

Earlier attempts had looked in Hermes' local memory or other folders. Naming the notebook and reading the tool calls let me see what was being searched. An empty working folder hadn't made the rest of the machine disappear.


## Optional: copy selected records

If you want copies to move between the hub and notebook, the companion installer can add sync after you choose the connection. First read what it proposes to upload and where it will store the credential. You should know which material is about to travel.

| Direction | What the inspected setup copies |
|---|---|
| Hub to notebook | Observations, skills and individual decisions. |
| Excluded from that upload | `profile/` and `AGENTS.md`. |
| Notebook to hub | Supported people, events and claims into `world/`, marked with their source. |

Only that selected material moves. You aren't creating a full mirror of either the hub or notebook, so a fact kept only in your profile still won't appear in the notebook's phone search.

The installer version inspected here runs sync **after a Git commit**, if it installed its post-commit hook, and during an hourly check. A commit is the saved local version from Chapter 18. Pressing Save in an editor doesn't start that hook. Check which trigger the installer actually added, because it may preserve an existing custom hook.

Run a visible check after setup:

```
hub-notebook-sync --verbose
```

Read what was sent, what came back and what failed. The log is `~/.hub/notebook-sync.log`, where `~` means your user folder. Try a second run without changes and check that it doesn't upload the same material again. Silence is easier to trust once you've seen what it means.

Files marked `origin: menerio` came from the notebook and can be replaced by a later sync. Correct the original in the notebook, or your local correction may be lost. The copying code inspected for this book preserves locally owned records; it doesn't claim every file in `world/`.

It also checks for a response that looks like an unexpected mass removal. That's a useful safeguard, though it can't catch every possible incomplete response. Keep the recovery copies you arranged earlier.

## Check access and recovery separately

Cancel a key in the service's API Keys page when you no longer want the applications using it to connect. Pausing sync is a different step: disable its machine schedule and any installed commit hook, as described in Chapter 30. Canceling a key does not remove old copies.

For recovery, inspect the local `world/` copy and export original notebook notes separately if you need them. Finding a note in search tells you it can be found today; it doesn't tell you that the whole notebook can be restored.

Ask the assistant to name the source when it uses notebook information. If a detail is wrong, you want to know where to fix it without searching every place the assistant might have looked.
