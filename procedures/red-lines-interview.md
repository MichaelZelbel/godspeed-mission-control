# Red Lines Interview (Chapter 17)

The printed red lines are a safe start. This prompt makes them yours: your
assistant interviews you, one question at a time, then rewrites the rule
files in your words. Run it in a session with your folder attached; the
eight rules are already in `rules/`, one file each.

```
Read the files in rules/. Interview me about them, one question at a time:

- whether you may ever send messages in my name
- whether you may ever spend money
- when you may delete
- what I want you to store about other people, anywhere from "nothing they could not read over my shoulder" to "useful facts, but never their secrets"

Ask about anything in my life that deserves its own line.

Then rewrite the files in rules/ in my words, keeping the header at the top of each one, and show me what changed before you save it.

When I say yes, run mc-compile-rules so AGENTS.md catches up.
```

Two rules for judging what comes out:

- **Keep it to about ten lines.** A rulebook short enough to hold in your
  head is a rulebook you will notice being broken.
- **Every rule bans an outcome, not a tool.** "Never send anything in my
  name" covers apps you have not connected yet. "Never use the email
  connector" does not.

After the rewrite, `mc-compile-rules` puts the new one-liners into
`AGENTS.md`; then throw the grenades from `red-lines-template.md` again.
