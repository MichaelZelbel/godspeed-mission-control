---
name: memory-audit
description: Check current facts and the memory every assistant actually reads against dated evidence, repair authorized mistakes without losing history, and verify later retrieval.
---

# Audit current memory

Use this when an answer used to be true, the shared instructions have drifted, or the user asks to audit memory. This is a claim-by-claim reading job. A regex over prose cannot tell whether one uncontested value is simply old. Events remain historical events; current claims need current evidence.

The reading discipline is adapted, with credit, from Cole Medin's second-brain-audit workflow at github.com/coleam00/skills. This implementation uses the notebook's structured facts instead of copying his prose-extraction script.

## Installation and boundary

Read the current workspace operating manual and its authorization rules. Use only the selected notebook and its visible records. The notebook's MCP offers list_records, search_knowledge, write_fact and review_suggestions; inspect their actual schemas before writing. The installed file CLI provides:

```
godspeed validate
godspeed record list claims
godspeed record list fact_slots
godspeed record list contacts
godspeed record list entities
godspeed memory search <words>
```

These commands run with GODSPEED_WORKSPACE set to the chosen installation. Never infer the workspace from the shell's current directory. When invoking the bundled CLI directly, use its actual installed Node and notebook/bin/godspeed.mjs. A command absent from this installation is an implementation gap, not permission to use another personal installation.

## First: cheap structured checks

1. Validate record identity, references and retained conflicts. Read the findings rather than deriving them again from prose.
2. Group current claims by subject_type, subject_id and attribute. Resolve cardinality through fact_slots. Two current values for a single-valued slot are a conflict. Different attributes and intentionally multi-valued slots are not duplicates.
3. Check actual review dates and sources. An overdue review is a reason to investigate, not proof the fact is false.
4. Find documents that explicitly declare dependencies on now-closed claims and have not been reviewed since closure. Use actual dependency metadata where present. Do not invent a dependency from a word match; report the absence of tracking separately.
5. Find duplicate identity candidates using names, aliases, stable external identity and source evidence. A matching name alone is not authority to merge people. Keep the candidate IDs and evidence for review.

## Then: read the complete active surface

Discover what this installation loads at every assistant start. Inventory each actual file, byte size, configured source and whether it reached the prompt. Include the shared operating manual, compiled rules, stamped profile summaries, the assistant's configured instruction entry point, memory index, and any provider or external notebook profile explicitly connected to this workspace.

Read each surface completely, not with a grep or a sample. Follow stamped summary lines back to their owning profile file before acting on detail. A referenced file that is not loaded is a finding. A file on disk does not prove it reaches the assistant. If context limits truncate a file, split the reading and account for every part; do not mark the surface reviewed until all parts were read.

Do not sweep another assistant home, another account, secrets or all historical prompts. Archived facts are relevant only when they leaked into the current surface or answer.

## Claim-by-claim investigation

Extract every current-sounding statement: owner, status, address, endpoint, rate, version, counter, deadline, location, tool availability, instruction naming a field/file/flag, and what is supposedly loaded or running. Keep an exact quote and source location. Skip statements clearly phrased as past events.

For each claim, search in this order, stopping when reliable dated evidence answers it:

1. Current structured claims for that exact subject and attribute, including their validity dates, origin and source.
2. Visible notebook/file search, followed by the full matching source. A search hit alone is not enough.
3. The selected external memory connection, if configured and explicitly in scope. Distinguish dated claims from undated note sentences.
4. The owning file's current contents, change history and last verified evidence.
5. A live read of the exact selected service or public primary source when the claim is about current availability or state.

Sort every investigated claim into **confirmed**, **contradicted**, or **unsupported**. Keep the evidence and its date. Unsupported means the sources searched did not establish it; do not label it false or ask the user to fill a worksheet. Search available context before asking the one fact only the user can supply.

## Correct safely and preserve what happened

Read origin before deciding how to correct a value. A machine-written mistake with decisive evidence can be corrected within the user's authorization. Preserve the old value, source and reason. Do not silently overwrite the user's own text.

For a genuinely changed current fact, write a dated replacement claim through write_fact. Keep the actual contact/entity subject ID. Confirm that the previous claim closed and remains retrievable in history. A named other person's fact must never become a self fact. When a user-written value conflicts with evidence but the intended meaning is ambiguous, create a review proposal; do not guess.

Two different real facts remain separate named attributes. A coarse machine-created slot that lost distinctions needs a truthful correction, not an invented merged identity. Lists, packing lists and checklists stay lists. Do not restructure them to make the checker happy.

Rule retirement, identity merges and changes outside the requested installation require their actual authorization. This audit never grants broader rights. Credentials stay device-private; never place them in findings, evidence notes or public output.

## Verify what the assistant will say next

After an authorized correction, query the current claim, its history and the visible search result. Ask a fresh ordinary notebook conversation the original question and a natural synonym. Check that the correct person, current value and source appear, that the old value is historical, and hidden/sensitive material remains excluded. Restart only the selected test service when authorized, then repeat retrieval. A saved row alone is not memory acceptance.

For prompt drift, verify the actual startup surface again. Updating a source file without checking the loaded prompt does not establish repair. Preserve a before/after quote and a way to reverse the correction.

## Deliverable

Save one dated audit note in the selected notebook when saving is authorized. Contradicted claims come first, unsupported second. Each finding says what was wrong, its practical consequence, what was actually corrected, evidence/date and how to reverse it. Distinguish proposals from completed changes.

Include the number of complete surfaces reviewed, which connected sources could not be read, and facts the audit cannot see because they were never recorded. A small findings list is not proof of complete knowledge.

The user-facing result is one short explanation and one notebook link when useful. Ask at most one specific user-only question after exhausting available evidence. Never hand over blanks, forms or checks the assistant can do. Do not publish or send the report outward without separate approval.
