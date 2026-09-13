# Chapter 15: Check That Your AI Skills Work

A skill can give you a good answer and still need your help every time. By then, the conversation may hold quite a history: background from twenty messages ago, a corrected date, a note about where to look. Some of that reached the saved instructions; some may still live only in the chat. We need to find out how much help the file can provide when that conversation is gone.

## Test 1: start fresh

Choose a skill and save a realistic test input. Open a new session in the hub, name the skill and provide only the input its instructions require. Wait for the result before adding hints.

Start with the details that matter most to the job: the source the skill must read, the date it must keep, the promise it must leave to you. Check these against the saved input and instructions.

I used a weekly client-update skill for Sam, the fictional illustrator whose client Nadia was waiting for his cards. This historical test used July practice files that requested two options in a bad-news message. Other examples use revised files with three. The different counts reflect different test inputs, not a rule about how many options you should offer.

The fresh-session reply began:

> **Gaps I need from you first**
>
> Cards 16 to 20, no status given. Where are they?
>
> The 28th is two days out. Do you still expect to hand her all 20 on the 28th, or is a partial delivery now the honest picture?

It also left a delivery date undecided:

> Cards 13 to 15 are in second-pass colour and I'll have them in front of you [WHEN, needs your call].

It hadn't invented a date, which was what I wanted. It had also asked questions outside the draft, despite my request for a draft only. Reading it again, I could see my contribution to the problem: I'd asked for a complete message without supplying the facts to complete it. The assistant had to put the missing information somewhere. Giving it a short line above the draft made the instruction possible to follow honestly.

The revised instruction became:

```
6. Give me the draft only. If something is missing, put it in a single line above the draft that starts with "Need:" and nothing else.
```

## Test 2: remove a required source

Ask the assistant to create a separate, empty practice folder, then open it in a new session. Provide the skill text and a realistic job, but leave out one source the instructions require. Tell the assistant to use only the supplied practice material. Leave your working hub where it is. We can test a missing file without removing files you use for real work.

A skill that requires profile files should tell you when it can't find them. A limited result is useful if it makes the gaps clear. Filling those gaps with invented background would defeat the test.

The reply was:

> I can't run the recipe: `profile/projects.md` and `profile/voice.md` aren't in the working directory (it's empty). The recipe says to read Nadia's entry first and use nothing else. Without it I'd have to invent context, which the recipe forbids.

That reply gave me a problem I could fix: supply the missing files. I prefer finding that out while the message is still a draft, with nobody waiting for a promise I didn't mean to make.

Then I tried vague instructions about using what it knew, instead of naming the files. The update thanked the client for approving work she had never approved, and signed the message with my name rather than Sam's. Sam's files weren't in the practice folder. My name still found a way into the draft, a reminder that a fresh folder doesn't remove every piece of machine or account memory.

The invented approval was easy to miss because the update looked useful. Name the files your skill needs and explain what to do when they are absent, then repeat the test. In this test, the named-file version gave me a clear report of what was missing instead of a message whose confidence I had to untangle.

## Test 3: compare the reply with the rules

Now ask the assistant to check the answer against the instructions. Give it the complete input, the resulting answer and any required profile files, so it has the material needed to judge. Name the skill you tested; the assistant can find its instruction file.

```
Find the instruction file for the skill I name. Check the reply below against every requirement in that file and the source material supplied with it.

For each rule, say kept, broken or cannot check. Quote the relevant evidence. Do not treat the reply's own claim as proof. Name missing input needed for a judgment. Do not rewrite the reply yet.
```

*[Copy prompt](https://srv1328602.hstgr.cloud/hub/8d0da988c1c44fbaa71bdfef1d4144dc/prompts.html#chapter-16-box-2)*

The earlier email recipe asked for uncertainty marks, then insisted on a draft with no extra remarks. When I asked the assistant to check the result, those instructions collided:

> 1. Kept. The reply marks its guesses with `[CHECK]`: "[CHECK: confirm delivery date]", "[CHECK: confirm interest]"
>
> 5. Broken. The reply contains commentary inside the draft, rather than giving the draft only: "[CHECK: confirm delivery date]", "[CHECK: confirm interest]"

It counted the marks as extra remarks. Under that reading, I had managed to make the same marks both compulsory and forbidden. I could see why the instructions appeared to disagree. The current email recipe explicitly allows marks inside the draft and a short line above it for missing sources. The assistant no longer has to choose which part of the request to break.

The same test found that one draft offered a single option where that practice voice file asked for two:

> 2. Broken. The bad-news section gives only one option, not two: "I can have them with you by [CHECK: the 4th]"

The two-option requirement belongs to Sam's practice file; your own voice file supplies the number for your test.

## Test advice as well as formatting

For a decision skill, remove one essential source from a copy of the input and see what happens. Then give it two competing goals without saying which should win. Look for the unresolved choice in the answer. Being told what you still need to settle is more help than a tidy recommendation that quietly settles it for you.

The assistant can miss mistakes in its own answer, including mistakes it made confidently the first time. Check the few claims that drive your decision against the quoted evidence yourself. Bring in an independent source or qualified reviewer when a lot depends on the answer.

## Keep the failure that taught you something

Save the input and failed result beside your test notes. After changing the skill, run that input again in a fresh session. You already know where to look, so you can see whether the repair addressed the failure that prompted it.

Sometimes the rule is already clear and the assistant missed it. Look at the record of what it read and where its answer went wrong before rewriting the instructions. A louder version of the same sentence doesn't explain why it was missed the first time.

The awkward draft can also help you check later improvements. Keep it long enough to see whether the old problem returns.
