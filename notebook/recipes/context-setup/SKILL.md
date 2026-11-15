---
name: context-setup
description: Getting to know your owner after the technical setup, in a short chat you lead. Use when they send the word "context" on its own (any case, in Telegram or the notebook's chat); when the [godspeed-context] block says they were invited and this message answers it ("ok", "yes", "let's go", "sure", a city, something about themselves); when that block says this chat is under way and the message answers your last question; and when they ask to tell you about themselves ("let me tell you about me", "get to know me", "I want to fill in my profile").
---

# Getting to know you

The technical setup is done: an AI is connected and the chat works. This is the second part, a
short chat you lead, about five minutes. You learn three things: where they live (only for the
time zone), a little about them, and what they want help with first. Every part can be skipped.

## How every message is written

- One question per message. At most three short sentences, plus a list or one copyable block where
  a step below says so.
- Plain everyday words. Never name a tool, a file, a folder, a recipe, a record or a setting. Never
  say "profile page" or "status".
- Never refuse an answer for being short. "Nurse, two kids, live in Leeds" is a good answer.
- "skip", "not now", "later", "pass" or "no" on a question moves on to the next part. "stop",
  "enough" or "another time" ends the chat: go to step 4.
- If they ask something else in between, answer it, then come back with one line: "Shall we go
  on? " and the open question again.
- Never ask for something the status says you know already.

## 0. Begin

Call `context_setup` with `{"action": "status"}`.

- `state` is "done": send exactly: "We did this already. You can see and change what I learned in
  your notebook, on the page Godspeed's brain, under What it knows about you. Want to add or change
  something? Just tell me." Stop here.
- Otherwise call `context_setup` with `{"action": "start"}` and send exactly:
  "Great, about five minutes. I ask three things, one at a time, and you can skip any of them."

Then go to step 1 in the next message.

## 1. Where they live

Look at `timezone.from` in the status.

- "browser": send exactly: "I set my clock to {timezone.city} time, from your computer. If you live
  somewhere else, tell me your city." Then go straight on to step 2 in the next message. If a later
  answer is a city, do what "unknown" below says with it, then carry on where you were.
- "answer": they told you before. Say nothing about it; go to step 2.
- missing or anything else: send exactly: "Which city do you live in? I only use it for your time
  zone, so a reminder you ask for at 9:00 comes at 9:00 your time."
  When they name a place, call `context_setup` with `{"action": "timezone", "city": "<the place
  as they wrote it>"}`.
  - `found` true: send "Got it: {city} time." and go to step 2.
  - `found` false: send "I do not know the time zone of {their words}. Type the nearest big city,
    like London or Vienna." and try again with their answer.

## 2. A little about them

If `about.told` in the status is true, they told you before: go to step 3.

Otherwise send exactly this one message:

"Now a little about you, so I can help from day one instead of asking you everything again. Pick
one:
1. You have read the book Teach It Once and have the file what-my-ai-knew.md: send it to me with
   the paperclip.
2. You already use ChatGPT or Claude: let it write this for you. I send you a message to copy
   into it; it writes down what it knows about you, you correct it, and you send me the result.
3. Neither? Then I ask you five short questions, one at a time.
4. Not now: that is fine, tell me any time.

Reply with a number, or just tell me about yourself."

What they answer:

- **A file** (the content of the file reaches you with their message): keep it, as "Keeping it"
  below says, with the file's whole text as `text`.
- **1** but no file: "Tap the paperclip next to where you type, choose the file what-my-ai-knew.md
  and send it."
- **2**: send these three messages, in this order.
  1. "Copy the next message into ChatGPT or Claude, whichever you use most. When it has answered,
     correct anything that is wrong right there in that chat. Then copy its whole answer and paste
     it here."
  2. This prompt, alone in its message, in a code block so it is easy to copy, exactly:
     ```
     Help me create a short briefing that I can give another AI assistant. Start with information available to you in this conversation, accessible earlier conversations and saved memory. Do not imply you can read material you cannot access.

     Tell me what you know under exactly these five headings:
     - Who I am and what I do
     - The people who matter
     - What I am focused on now
     - How I like to be helped
     - My hard limits

     Mark uncertain claims with (?). Distinguish things I told you from your interpretations. Do not include passwords, access keys, payment details or other credentials.

     Then list at most six short questions that would fill important gaps. List them without asking me to answer yet.
     ```
  3. "The same message is also here, with a copy button: https://querino.ai/prompts/about-me-extraction-step-1
     If you would rather send me a file: once you are happy with its answer, ask it for one with
     this message, https://querino.ai/prompts/download-my-ai-briefing, and send me the file."

  When their paste arrives: a long paste can come in several messages. If it looks cut off (it
  stops mid-sentence, or not all five headings are there yet), send "Got the first part. Send the
  rest, and I put it together." and wait. Then keep all of it as one `text`.
- **3**: ask these five, one per message, each one skippable. Keep their words.
  1. "What do you do, and what fills your days?"
  2. "Who are the people who matter most to you, at home and at work? First names and how you know
     them are enough."
  3. "What are you focused on right now?"
  4. "How do you like to be helped? For example short or detailed answers, blunt or gentle."
  5. "Is there anything I should never do for you?"
  Then write a short summary from their answers only, under these headings, leaving out a heading
  they skipped: Who I am and what I do, The people who matter, What I am focused on now, How I like
  to be helped, My hard limits. Write it in their voice ("I am a nurse in Leeds."), never guess or
  add anything. Send the summary, then: "Is that right? Tell me what to change, or say yes." Change
  what they say, show it again, and keep it once they say yes, with the summary as `text`.
- **Their own words** instead of a number: that is their answer. Keep it.
- **4**, or skip: send "All right. Tell me about yourself whenever you like." and go to step 3.

**Keeping it.** Call `context_setup` with `{"action": "about", "text": "<what to keep>", "words":
"<their latest message, copied exactly>"}`. Then send exactly: "Thanks, I keep that and use it
whenever I help you." and go to step 3. If the tool refuses, say "That did not save. Shall I try
again?" and never claim it was kept.

## 3. What they want help with first

If `goals` in the status is not empty, send "You told me already what you want help with first:
{the first goal}." and go to step 4.

Otherwise send exactly:

"Last question: what would you like my help with first? It can be small. For example:
- keeping track of appointments and deadlines
- a short message every morning about your day
- sorting your notes
- a project you keep putting off
Or tell me in your own words."

- They pick one or say their own: shorten it to one plain sentence in their words, call
  `context_setup` with `{"action": "goal", "title": "<that sentence>", "words": "<their latest
  message, copied exactly>"}`, and send "Got it: {the sentence}. That is what I help you with
  first." For a project they keep putting off, ask first, in one line, which project it is.
- "no idea", "not sure", "I don't know": offer two or three suggestions, numbered, each one short
  and built only on what they told you in step 2 (with nothing from step 2, use the four examples
  above). They pick a number or say their own; then file it as above.
- skip: send "All right. Tell me any time." and go to step 4.

## 4. Close

- Something was kept in step 1, 2 or 3: call `context_setup` with `{"action": "done"}` and send
  exactly: "Thanks! You can see and change what I learned in your notebook, on the page
  Godspeed's brain, under What it knows about you. Your goal is in Settings." Leave out the last
  sentence when no goal was filed.
- Nothing was kept: call `context_setup` with `{"action": "skip"}` and send exactly: "All right, we
  leave it for now. Send context whenever you like."
