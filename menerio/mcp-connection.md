# One memory, every tool (Chapter 26)

MCP is a standard socket. Any AI tool that speaks it can read the same notebook. One key, and
every tool you use answers from the same notes. No tool gets a copy; every tool reads the
same shelf.

## Make the key

Menerio, then **Settings**, then the **API Keys** tab. Press **Generate new API key**. Name it
after the tool or machine that will use it, because in six months you will want to know which
key belongs where.

The grid under **This key may touch** starts with every box ticked. For your own mission control or
assistant, leave it that way: full access is the right shape for the key you hold yourself.
Untick boxes only for a key you hand to somebody else's app, and that key can never do more,
whatever the app asks. (A refused tool call names the missing box, so a too-narrow key is a
one-line fix, not a mystery.)

The dialog then says, verbatim:

> Copy this key now, you won't be able to see it again

Believe it. Copy it into your password manager immediately. Never into your folder.

**One key, not two.** Until 2026-08-16 Menerio handed out a separate `mnr_mcp_` token for the
connector and an `mnr_` key for the API. Since 2026-08-18 any API key opens the connector, and
the boxes on the key decide which tools answer, so there is one key and one off-switch. Old
`mnr_mcp_` tokens still work, and the **MCP Server** tab still lists them so any of them can be
revoked; it no longer makes new ones.

## The connection facts

- Endpoint: `https://mcp.menerio.com`, exactly this. No `/mcp`, `/sse` or `/v1` on the end.
- Transport: MCP Streamable HTTP.
- Auth header: `Authorization: Bearer <key>`. Keys start `mnr_`.
- Tools with nowhere to put a header: append `?key=<key>` to the URL instead.
- If a tool call is refused with a message naming a box (for example "This key's boxes don't
  include Notes"), the key is real and too narrow. Edit the key on the **API Keys** tab and
  tick the named box.

## Door one: Hermes, in one line (the header, properly)

Hermes keeps its connections in its own settings, per profile, never in your folder. In
a terminal:

```
hermes mcp add notebook --url https://mcp.menerio.com
```

**Call it `notebook`, not `memory`.** Hermes has a built-in memory tool of its own, and a
connection named `memory` gets confused with it: asked for "my memory tools", Hermes 0.20.6
searched its own two memory files, found nothing, and said so (measured twice, 2026-09-02).

It asks "Does this server require authentication?" (yes) and then "API key / Bearer
token" (paste the key). The key is written to Hermes' own `.env` for secrets as
`MCP_NOTEBOOK_API_KEY`, and the settings file only ever names it. The connection is tried
on the spot. Then:

```
hermes mcp list
hermes mcp test notebook
```

Verified 2026-09-02 on Hermes 0.20.6: `list` shows `notebook  https://mcp.menerio.com  all
enabled`, and `test` reports `Connected` and `Tools discovered: 58`. `hermes mcp configure
notebook` switches individual tools off; the writing tools are the ones to consider.

Hermes also has a catalogue of well-known servers (`hermes mcp catalog`, then `hermes mcp
install <name>`). Menerio is not in it, which is why it is added by address.

## Door two: Claude Code, the developer's tool (header, properly)

```
claude mcp add --transport http memory https://mcp.menerio.com --header "Authorization: Bearer PASTE-YOUR-KEY-HERE"
```

Then `claude mcp list` and look for:

```
memory: https://mcp.menerio.com (HTTP) - Connected
```

## Door three: the folder file, for Claude Code

The third door is a file in your folder, `.mcp.json`, naming your notebook's
address. Claude Code finds it whenever it opens the folder and connects with
nothing to click. It does not hold your key, it **names** it: the line reads
`${MENERIO_API_KEY}` and the value is fetched from the folder's locked store
when the tool starts, which is why the file can travel to your backup like
every other file.

Verified 2026-08-30, in Claude Code, with no connector panel touched: a session
opened on a folder whose `.mcp.json` names Menerio reached the notebook and
answered `Total notes: 697. This week: 49.`

**Hermes does not read this file.** Checked on Hermes 0.20.6 with a folder that
had one (`hermes mcp list`: "No MCP servers configured"), and confirmed in the
source, where the string `.mcp.json` does not appear. For Hermes the thing that
travels is door one, run once per machine; the installer prints the line when
it lays the folder down.

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

## Wire an agent tool automatically

The MCP page also has an **Agent Setup Prompt** with a **Copy prompt** button. Paste it into an
agent tool and it installs the server and writes the rules it should follow every session (read
the profile at session start, search before answering from memory, capture new facts) into that
tool's instructions file. It asks for your key as its first step.

## Housekeeping

- **One key per place.** Retire a machine, revoke that one key, everything else keeps working.
- **The API Keys tab is the off-switch.** Revoking a key cuts that tool off at once. Know where
  the page is before you need it.
- **Reading before writing.** A tool that can save notes can save the wrong note forever.
  `hermes mcp configure memory` switches a writing tool off until you want it.
