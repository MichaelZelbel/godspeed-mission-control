# Chapter 29: Connect Your AI Tools to the Same Notebook

An assistant can use a note from your online notebook only if it has a working connection and permission to read it. This chapter adds that connection.

The connection uses MCP, a standard way for an AI application to call another service's tools. Each application still needs its own setup. Data returned by those tools may enter its conversation records.

## Create a key with limited access

In Menerio, open **Settings**, then **API Keys**. Name the key for the tool or computer that will use it. Review the available data categories and enable only what that job needs.

Keep the generated value in your password manager. It is a credential, like a password, and does not belong in a chat, a screenshot or an ordinary hub file. A warning to copy it now means you may not be able to display it again later.

Separate keys make it easier to stop one application independently. A shared key is simpler to distribute, but canceling it stops every connection using it. Other valid keys are unaffected.

The connection address used by the companion setup is:

```
https://mcp.menerio.com
```

## Connect Hermes

In a terminal, enter:

```
hermes mcp add notebook --url https://mcp.menerio.com
```

Use `notebook` as the name. Hermes has its own local memory files, so calling both things “memory” makes requests less clear.

When the command asks whether authentication is required, choose yes. Paste the credential into the dedicated token prompt, not into the command line. Hermes stores this connection in its own configuration; protect that location too.

Then check it:

```
hermes mcp list
hermes mcp test notebook
```

The list should identify the notebook address and the test should discover tools. A historical run found 58 tools; your current count can differ. A successful connection test proves access, not that the assistant will choose the right tool.

Inspect the reading and writing tools before relying on them. Use `hermes mcp configure notebook` to limit enabled tools when supported by your version. Start with reading if that is all the job needs.

## Optional: connect Claude Code

If you use the developer tool from Chapter 5, its project configuration can refer to an environment variable without containing the secret. An environment variable is a named value made available to a running program.

Ask the assistant to prepare the configuration and input method first:

```
Configure a notebook connection for Claude Code in this hub. Inspect the existing .mcp.json and current client help before editing. Keep unrelated connections. Use https://mcp.menerio.com and an Authorization header that refers to ${MENERIO_API_KEY}, never the literal credential.

Show me a masked local input method for this operating system, so I can load the key without putting it in chat or shell history. Launch the client from the environment containing the key and test a read-only connection. Report success or the actual error without printing values. Do not broaden key permissions or enable writes to repair a read failure.
```

Hermes does not read this project's `.mcp.json` in the setup inspected for this book. Its own connection remains separately configured. Copying a placeholder file to another computer does not load the actual secret there.

Chapter 30 explains the optional encrypted credential store. A password manager and a separate connection on each machine are also valid.

## Prove which source answered

In a fresh session, ask a question about the harmless notes you put in the notebook. If you used the fictional Nadia notes, use:

```
Use my notebook's tools, and nothing on this computer. Who is Nadia, what is the latest on next year's book, and how does she want bad news delivered? Answer only from what the notebook returns, identify the notes read, and say plainly if you cannot find something. Change nothing.
```


An earlier test returned:

> - Who Nadia is: I cannot find a contact record or further identification for Nadia. The notebook only identifies her through notes about the book and communication preferences.
> - Latest on next year's book: Nadia said today that its budget has doubled. She hinted that there could also be a second illustrated title for you.
> - Bad-news delivery: Give her three options for a setback, not just one. Warn her early; she does not forgive late warnings quickly.

That gap was useful. The notebook notes did not establish Nadia's role. Sam's separate profile did, but this request deliberately excluded that source.

Earlier attempts had searched Hermes' local memory or other folders. Naming the notebook and inspecting the tool calls made the test more specific. An empty working folder alone does not prevent a tool from reading elsewhere.


## Optional: copy selected records

The companion installer can add notebook sync after you choose to connect it. Review the proposed upload scope and the credential storage before enabling it.

| Direction | What the inspected setup copies |
|---|---|
| Hub to notebook | Observations, skills and individual decisions. |
| Excluded from that upload | `profile/` and `AGENTS.md`. |
| Notebook to hub | Supported people, events and claims into `world/`, marked with their source. |

That is selected material, not a complete mirror of the hub or notebook. It does not make a profile-only fact available in the notebook's phone search.

The inspected installer runs sync **after a Git commit**, when its post-commit hook is installed, and on an hourly check. A commit is the local version-history snapshot from Chapter 18. Pressing Save in a text editor does not trigger that hook. An existing custom hook may be preserved, so inspect which trigger was installed.

Run a visible check after setup:

```
hub-notebook-sync --verbose
```

Inspect what it sent, what it retrieved and any failed operation. The runner's log is `~/.hub/notebook-sync.log`; `~` means your user folder. A second run with unchanged inputs should avoid uploading unchanged material. Verify that result rather than assuming it from silence.

Notebook-derived files marked `origin: menerio` are copies and may be replaced by a later sync. Correct them in the notebook. The inspected copying code preserves locally owned records rather than treating every file in `world/` as its own.

It also guards against a response that looks like an unexpected mass removal. That is one check, not a guarantee that every incomplete response will be caught.

## Check access and recovery separately

Cancel a key in the service's API Keys page when you no longer want the applications using it to connect. Pausing sync is a different step: disable its machine schedule and any installed commit hook, as described in Chapter 30. Canceling a key does not remove old copies.

For recovery, inspect the local `world/` copy and make a separate export of original notebook notes if you need those too. A successful search is not proof that your notebook can be fully restored.

You now have a second source the assistant can consult. Keep its source name visible in answers so you know where to correct a wrong fact.
