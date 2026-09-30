# Testing a Skill (Chapter 16)

Three tests that show how much a skill can do without the conversation
that built it, then a check for decision skills and a way to keep what
you learn.

## Test 1: start fresh

Choose a skill and save a realistic test input. Open a new session in
your mission control, name the skill and give only the input its
instructions require. Wait for the result before adding hints.

What you are looking for:

- It read the source the skill must read.
- It kept the dates the job depends on.
- It left every promise to you.

If a skill that must give a draft only has nowhere to put missing facts,
add a rule like this one:

```
6. Give me the draft only. If something is missing, put it in a single line above the draft that starts with "Need:" and nothing else.
```

## Test 2: remove a required source

Ask the assistant to create a separate, empty practice folder and open it
in a new session. Give it the skill text and a realistic job, leave out
one source the instructions require, and tell it to use only the supplied
practice material. Your working mission control stays as it is.

- **Pass:** it says which source is missing, and any limited result makes
  the gap clear.
- **Fail:** it fills the gap with invented background.

If it fails, name the files the skill needs and say what to do when they
are absent, then repeat the test.

## Test 3: compare the reply with the rules

Give the assistant the complete input, the resulting answer and any
required profile files, name the skill you tested, and paste:

```
Find the instruction file for the skill I name. Check the reply below against every requirement in that file and the source material supplied with it.

For each rule, say kept, broken or cannot check. Quote the relevant evidence. Do not treat the reply's own claim as proof. Name missing input needed for a judgment. Do not rewrite the reply yet.
```

*[Copy prompt](https://querino.ai/prompts/rule-check)*

## Decision skills

Remove one essential source from a copy of the input, then give the skill
two competing goals without saying which should win. A good answer names
the choice you still have to settle. Check the claims that drive your
decision against the quoted evidence yourself.

## Keep the failure

Save the input and the failed result beside your test notes. After
changing the skill, run that input again in a fresh session. If the rule
was already clear, look at the record of what the assistant read before
rewriting the instructions.
