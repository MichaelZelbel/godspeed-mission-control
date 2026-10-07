---
name: talk-about
description: Capture and manage topics to discuss with a person in the notebook, prepare for a call, change priority, record a discussion, stop repetition, undo, or reopen. Use for English or German requests such as "talk to Alex about", "we discussed", "bring this up each time", "mit Alex besprechen", "haben wir besprochen", and "Was soll ich ansprechen?".
---

# Person conversation topics

the notebook owns topics and their discussion history. Use its topic MCP tools. Never save a parallel note, reminder, world claim, or local topic file. The tools require the feature's database and MCP release; if unavailable, say the topic has not been saved and identify the missing tool. Do not substitute notes.

## Resolve before writing

1. Read visible `list_records(type:"profile_facts")` when relationship context is needed, then `search_knowledge` and visible `list_records(type:"contacts")` for the name, alias, or relationship. Search existing context before asking who someone is.
2. Resolve an exact visible contact ID. A spouse alias needs evidence from profile/search, never a guess. If multiple people plausibly match, ask one short question. Do not create a person because search missed. Hidden or sensitive people remain subject to the notebook's existing tool restrictions; do not bypass them through direct IDs or another storage path.
3. Call `list_contact_topics` for that person and relevant status. Follow pagination when matching or preparing a full agenda. Match meaning and wording. For an ambiguous topic, ask one short question before writing.
4. Apply one targeted command below, using the returned topic version. Generate a fresh UUID request ID for a new intent. Preserve the exact ID and payload on transport timeout retries. Read the authoritative response before confirming anything.
5. Confirm a successful write in one plain sentence with the returned person's notebook link. Say what changed. A tool error is not success. Do not invent a URL, event ID, or version.

## Intent to command

| Intent | Command and behavior |
| --- | --- |
| Add something to talk about | `create_contact_topic(contact_id,title,mode,priority,request_id)`. Default `one_off`, `normal`. Preserve the user's wording, trimmed, at most 300 characters. |
| Keep bringing it up | Create or update `mode: recurring`. Repetition means keep it on the agenda, without a schedule. |
| Make it important / less important | `update_contact_topic(topic_id,expected_version,patch,request_id)`, with `priority: high`, `normal`, or `low` as requested. |
| We talked about it / haben wir besprochen | `discuss_contact_topic`. One-off completes; recurring remains active. |
| We talked about it, no need again | `discuss_contact_topic` with `close_after: true`, including for a recurring topic. |
| Forget it / stop bringing it up | `archive_contact_topic`. This does not record a discussion. |
| Bring it back / wieder aufnehmen | `reopen_contact_topic`. Preserve history. |
| Undo that / rückgängig | `undo_contact_topic_event` with the latest event ID and expected version; never substitute reopen. |
| Prepare for a call | Read active topics, High then Normal then Low, oldest first within priority. Present the agenda with recurrence and last-discussed dates when useful. Do not mutate. |

An exact active duplicate may be acknowledged as already saved with the person's returned link. Similar wording with distinct meaning is not a duplicate. Never silently merge topics. Explicit priority or recurrence changes to an existing item require the update command.

For a past discussion date, interpret the user's local calendar date using the current time and timezone (use the installation timezone). Send an ISO timestamp with an offset. For a date without a time, use local noon as a storage convention, not a claim about the conversation's exact time. If the date is today and noon is still in the future, use now. "Yesterday" is the previous local date, not UTC minus 24 hours across a clock change. Omit `discussed_at` for now. Never claim a future discussion occurred.

For undo, use the latest acknowledged receipt only if nothing changed since it. Otherwise list the person's topics across active/completed/archived states and call `get_contact_topic_history` for the exact topic. Its first page has the newest events. Never skip a later mutation to undo an older event. On conflict, use those three status lists to reread the exact topic ID, following cursors as needed. An item newly archived makes an earlier active-topic edit ambiguous; ask before changing it.

On version conflict, reread the topic. Retry with a new request ID and current version only if the intended effect is still unambiguous; otherwise ask one short question. Never overwrite an intervening edit blindly. After an uncertain transport result, retry the original payload and request ID first so the database can return its original receipt. After a repeated transport failure, report that acknowledgement is uncertain, preserving the ID for later reconciliation. A reused ID with a changed payload is an error, not a retry.

A dated obligation with an explicit deadline or an explicit notification request routes to `../due/SKILL.md`. A date in a conversation request does not by itself create a reminder, including when it says which conversation to use. "Talk to Alex about Friday's trip" and "Mit Alex am Freitag über die Reise sprechen" are topics; "remind me Friday to call Alex" is a reminder. Acknowledgement after repeated timeouts is uncertain: do not assert either saved or unsaved.

## Evaluation

`evals.json` contains synthetic fixtures, never permission to write Michael's personal data. Run each input with the fixture's mocked search/tool replies and compare the requested command, clarification, and side effects. Include failure and timeout replies. A static schema check alone is not evidence that natural-language routing passed.


## Installed personal workspace

Use the current user workspace and its configured providers. Keep original workflow, command contracts, scripts and verification criteria. Read the workspace authorization rules before sends, sign-ins, payments or publishing. Search existing device-private credentials before asking for configuration. Saved output and a passing screen are not evidence that the full requested result happened.
