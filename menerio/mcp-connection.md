# One notebook, every assistant (Chapter 28)

MCP is a standard socket. Any AI tool that speaks it can read the same notebook. You connect
Menerio **once**, with one key, and every way you use your hub has it: Hermes, Claude Code and
Codex. No tool gets a copy of your notes. Every tool reads the same shelf.

## Make the key

First a free account: https://menerio.com/auth?tab=signup

In Menerio, open **Settings**, then the **API Keys** tab. Press **Generate new API key**. Name
it after your hub.

The grid under **This key may touch** starts with every box ticked. For your own hub, leave it
that way: full access is the right shape for the key you hold yourself. Untick boxes only for
a key you hand to somebody else's app, and that key can never do more, whatever the app asks.
(A refused tool call names the missing box, so a too-narrow key is a one-line fix, not a
mystery.)

The dialog then says, verbatim:

> Copy this key now, you won't be able to see it again

Believe it. Copy it into your password manager immediately. Never into a file in your folder,
and never into a chat with your assistant: a chat is kept as a log.

## Connect once

Run the installer again (the same file or line you used the first time) and say yes when it
asks about Menerio. It asks for the key once. It locks the key into your hub's store, in
`secrets/`, so every computer you own that opens your hub has it. Then it runs
`hub-menerio-connect` for you.

You can run that command yourself at any time:

```
hub-menerio-connect            connect every assistant on this computer, then test it
hub-menerio-connect --check    change nothing, only say how things are
```

It prints one line per assistant: connected, already connected, not installed, or failed with
the reason. Then it asks the notebook itself and tells you how many tools answered.

What it does, so nothing is a secret:

- **Claude Code:** it adds a server named `notebook` to `.mcp.json` in your hub folder. The
  file names the key as `${MENERIO_API_KEY}` and never holds it, so it can travel with your
  folder. Every other server in the file is kept.
- **Hermes:** it adds `notebook` to Hermes' own settings, again only naming the key. It also
  writes the key into one line of Hermes' own `.env`. The Hermes desktop app does not start
  from a terminal, so that file is the only place it looks. When you replace the key, the
  hourly notebook job updates that one line by itself.
- **Codex:** it adds `[mcp_servers.notebook]` to `~/.codex/config.toml`, with
  `bearer_token_env_var = "MENERIO_API_KEY"`. Codex reads the key from your terminal, which
  the installer already taught it.

It keeps a copy of each settings file it changes, next to it, ending in `.bak`. A connection
you made by hand earlier keeps working, under whatever name you gave it. Running the command
twice changes nothing the second time.

**It is called `notebook`, not `memory`.** Hermes has a built-in memory tool of its own, and a
connection named `memory` gets confused with it: asked for "my memory tools", Hermes 0.20.6
searched its own two memory files, found nothing, and said so (measured twice, 2026-09-02).

## What happens after you connect

- **Your hub is mirrored into the notebook**, under one folder called `hub`. Everything except
  `dev/`. The copies rank below your own notes. Menerio never mines them for facts and never
  exports them as files. `the-notebook.md` has the details.
- **`hub-search <words>`** is how your assistant finds things. It asks Menerio first, by
  meaning and by words together. When it cannot reach Menerio, it searches the files in your
  hub and says so on its last line. It never fails because the notebook is away.
- **"Make a note about X."** Your assistant files the note in the notebook folder that fits,
  links it to related notes, and tells you the title, the folder and the links.

## The off-switch

One key, one switch. In Menerio, open **Settings**, then **API Keys**, and revoke the key.
Every assistant loses the notebook in that moment, on every computer. Know where that page is
before you need it.

To replace a key, follow the steps in `procedures/keys-that-expire.md`: you make the new key,
and it goes into your hub's locked store. Every file above only names the key, so nothing
else has to change. Hermes' one written line follows within the hour.

## The connection facts

- Endpoint: `https://mcp.menerio.com`, exactly this. No `/mcp`, `/sse` or `/v1` on the end.
- Transport: MCP Streamable HTTP.
- Auth header: `Authorization: Bearer <key>`. Keys start `mnr_`.
- Tools with nowhere to put a header: append `?key=<key>` to the URL instead.
- If a tool call is refused with a message naming a box (for example "This key's boxes don't
  include Notes"), the key is real and too narrow. Edit the key on the **API Keys** tab and
  tick the named box.
- Until 2026-08-16 Menerio handed out a separate `mnr_mcp_` token for the connector. Since
  2026-08-18 any API key opens it. Old `mnr_mcp_` tokens still work, and the **MCP Server** tab
  still lists them so any of them can be revoked.

## The test that proves it

Make a completely empty folder. Open a session there and ask something only your notebook
knows:

```
Use my notebook's tools, and nothing on this computer. Who is <person>,
what is the latest on <a thing you took notes about>, and how do they
want bad news delivered? Answer only from what the notebook returns, and
say plainly if you cannot find something.
```

Both phrases matter, measured on Hermes 0.20.6. "Notebook" because "my memory tools" sends
Hermes to its own memory files. "Nothing on this computer" because "search my notes" made
it search the disk: an empty folder is empty, but the tools reach the whole machine, and it
answered fluently from a test folder two directories away. A plain "I cannot find anything
about that" is a pass too, if you never took the note: the point is that it answers from
the notebook or says so, and never invents.

## Reading before writing

A tool that can save notes can save the wrong note forever. In Hermes,
`hermes mcp configure notebook` switches single tools off until you want them. The writing
tools are the ones to consider.

## Appendix: by hand

You do not need this part if `hub-menerio-connect` worked. It is here for a tool the command
does not know, and for the curious. In each case the key is only named, and the value comes
from your terminal, which the installer taught it (`hub-notebook-env` prints it for a terminal
that was not).

**Hermes**, two lines, nothing to answer (checked on Hermes 0.21.2):

```
hermes config set mcp_servers.notebook.url https://mcp.menerio.com
hermes config set mcp_servers.notebook.headers.Authorization 'Bearer ${MENERIO_API_KEY}'
```

Then `hermes mcp test notebook`. It should say `Connected` and how many tools it found.
Hermes fills `${MENERIO_API_KEY}` from its own `.env` file (`hermes config env-path` shows
where that is), so the desktop app needs the line `MENERIO_API_KEY=...` in there. An older
page of the book used `hermes mcp add notebook --url https://mcp.menerio.com`, which asks for
the key and stores its own copy as `MCP_NOTEBOOK_API_KEY`. That still works. It does not
follow a key you replace.

**Claude Code**, in `.mcp.json` in your hub folder:

```
{
  "mcpServers": {
    "notebook": {
      "type": "http",
      "url": "https://mcp.menerio.com",
      "headers": { "Authorization": "Bearer ${MENERIO_API_KEY}" }
    }
  }
}
```

Hermes does not read this file (checked on Hermes 0.20.6, and in its source).

**Codex**, one line (checked on codex-cli 0.144.1):

```
codex mcp add notebook --url https://mcp.menerio.com --bearer-token-env-var MENERIO_API_KEY
```

**Any other agent tool:** Menerio's MCP page has an **Agent Setup Prompt** with a **Copy
prompt** button. Paste it into the tool. It asks for your key as its first step, so use it
only in a tool whose chat log you are happy to keep a key in, or give that tool a key of its
own with fewer boxes ticked.
