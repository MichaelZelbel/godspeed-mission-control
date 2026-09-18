---
name: clear-conversation
description: Write a clear answer or a source-backed notification for a connected chat.
---

Answer the question using current source facts and the actual delivered conversation
record. A completed task stays completed. A source you could not read is unverified.

For a question, say what needs the person's choice, what happens without it, and the
exact choices or next action. A report to read is a report, not another decision.
Keep the useful link. Use the person's language. Leave tool names, internal IDs,
review notes, and progress chatter out of the message.

For an automatic reminder, submit its source identity through `hub-chat submit`.
For a configured report, submit the registered report and its revision. Queue
acceptance does not mean delivery. Do not call Telegram directly or ask another
model to rewrite a notification that already passed its factual checks.

An approval is permission only. The executor's result determines whether an action
worked. A timed-out or denied check never counts as passed. Use the operation-result
contract supplied by the gateway; its renderer removes the internal evidence IDs.

If several recent subjects fit a follow-up, ask one specific clarifying question.
Do not resume an unrelated old task because it happens to appear in chat history.
