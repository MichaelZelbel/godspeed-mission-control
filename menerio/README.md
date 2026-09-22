# menerio

Optional. Chapter 28, "Give Your Godspeed a Notebook". Everything else in the book works without
this folder.

Menerio is the notebook. It can do two jobs for your mission control. The first comes with the
connection. The second is a separate choice, and it is yours.

1. **It holds the notes you write out in the world.** On the phone, in a hallway, in a shop.
   Every assistant you use can read them and add to them. Say "make a note" and the
   `keep-a-note` skill files it there. That is all a connection does by itself.
2. **It can make your whole mission control searchable by meaning.** The installer asks
   `Copy your mission control's files to Menerio for search?` and the default answer is no. When you say
   yes, a small program mirrors your mission control's text files into the notebook, under one folder
   called `godspeed`. Everything is mirrored except `dev/`. Your assistant then finds "the
   dentist" even when the file says "Dr. Aydin, teeth". When you say no, nothing from your
   mission control is sent, and `mc-search` searches the files on your computer.

When you said yes: the files in your mission control stay the truth. The mirrored notes are copies, and
each copy says so in its first line. Menerio ranks them below the notes you wrote yourself.
It never mines them for facts, and it never exports them as files. To change something,
change the file in your mission control. The copy follows within the hour.

You connect it **once**. The installer asks for your key, locks it into your mission control, and gives
the same connection to Hermes, Claude Code and Codex. Then it asks the question above. Make
a free account here first: https://menerio.com/auth?tab=signup

| File | What it is for |
|---|---|
| `the-notebook.md` | What goes in the notebook, the mirror and whether you want it, the first notes, the Review Queue, search. |
| `mcp-connection.md` | Making the key, connecting once, checking it, switching it off. A short "by hand" part at the end. |
| `ai-memory-transport.md` | Optional route: pulling out what an old chat product remembers about you and importing it as notes. |
| `interview-transfer.md` | Optional route: filling the notebook by being interviewed, when you would rather talk than paste. |

## The one number worth knowing before you start

A new free account gets **500 AI credits**, refilled monthly. A note costs about two, so a
month's allowance covers more notes than a diligent month produces. (Measured on a brand new
free account, 2026-08-13: four notes plus all their machine filing cost 10 credits.)

The mirror, when you switched it on, sends each mission control file once, and after that only the
files you changed. It never sends a file larger than 300 KB, so years of pasted conversation
in `prompts/archive/` cannot eat your allowance. It tells you which files it skipped.

Accounts created before the free allowance existed (mid-2026) can still show `0 / 0`, because
it was not applied backwards. If yours shows zero and nothing gets processed, that is why.
