# swap

Chapter 36: run your folder on a different company's tool and a different company's model.

- `opencode.json`: drop this next to your `AGENTS.md`. A dozen lines: which brain to hire, what it
  must ask before touching, and where your notebook lives. Notice what is not in it: your context,
  skills, rules and voice need no migration, because they are already in the folder.
- `three-questions.md`: the entrance exam, and the real answers a different company's model gave.
- `openrouter-notes.md`: one key, many models, with prices checked live 2026-07-26 and 2026-09-02.

## The finding worth carrying away

The same `AGENTS.md` is found differently by different tools. OpenCode reads it by name when it
opens a folder, and so does Hermes, the assistant used through Parts I to V. Claude Code, the
developer tool from Chapter 4, looks for `CLAUDE.md` instead, which is why that chapter has you
leave a one-line signpost with that name pointing at the real file.

Same file, same rules, different doorbell. The words travel as they are; only the wiring gets
rebuilt per tool. That is what portable actually means in practice, and it is why this book kept
insisting the important things be plain text.

The notebook server is named `notebook` here, the same name Hermes knows it by (Chapter 28), and
for the same reason: Hermes has a built-in memory of its own, and a second thing called "memory"
gets asked the wrong questions.
