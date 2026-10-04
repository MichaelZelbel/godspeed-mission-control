# Configured scripts and adopted periodic duties

These are optional choices inside the same Lead routine. None is enabled by default. They never publish, send, render a video or generate a company's output. Use the actual selected goal, collection and source IDs; the examples below are field schemas, not IDs to copy.

Read the collection's `field_schema` through the notebook before configuring a queue. `/lead configure` accepts independent patches: changing one duty preserves the other duties and selected profile URLs. `/lead help` lists the arguments. The normal Personal commands panel and ordinary chat accept these commands; the native CLI uses `lead configure '<JSON>'`.

Choose an explicit contribution shape with delivery_shape set to post, repost, comment or video. Auto keeps selection within the enabled capabilities. Selecting video requires the confirmed queue, and a short post cannot substitute for the chosen video. Due research and a justified quiet result still take priority. To disable a currently selected video pipeline, change its delivery shape in the same configuration patch.

## Complete video script

Configure `video` with `enabled:true`, `pipeline_confirmed:true`, `collection_id`, `title_field` and `script_field`. Confirmation is the user's statement that their production pipeline works. The collection must exist, be visible, accept the mapped text fields and have no additional required fields. Its primary title field must be the selected title field. `video:{enabled:false}` stops new scripts.

A video contribution includes a complete spoken script, at least one hundred words and at most thirty thousand characters, and timed visual directions beginning at zero and increasing. The ordinary exact-source, authorship, voice, independent factual/reader check and daily cap still apply. Filing is one transaction containing the contribution, note, actual collection item and notification. The collection item holds the full script and directions, its draft state and contribution ID. Read back that item, not just the contribution title. Changing the configured pipeline, destination, goal or position during drafting prevents filing. A script is a draft, not an actual produced or posted video.

## Monthly source measurement

Configure `monthly` with `enabled:true`, a local calendar `day` from 1 to 28, and up to ten `rungs`. Each rung has a distinct `id`, `title`, adopted `goal_id`, public `url` and `kind`. Every run after that month's chosen day checks for the retained measurement, even when today's contribution already used the daily cap. `/lead measurements` reads the retained results.

For `kind:"numeric"`, select `value_path`, a dotted JSON field containing an actual finite number. A missing field, numeric string, unreadable source or unavailable account remains `UNVERIFIED` with `value:null`. It is never converted into zero. Choose a documented public search or counter URL whose returned value has the intended scope; private feeds require their separately implemented connector.

For `kind:"citation-matches"`, select `items_path`, `text_path` and the exact `phrase` expressing the adopted idea. Count matching returned result texts regardless of whether the user's name accompanies the idea. Retain the denominator, exact matching quotes, result indexes and source hashes. This is explicitly a count among the returned results, not a claim about all citations on the internet. A verified empty complete result list can yield an observed zero; an unreadable or malformed list cannot.

Each measurement keeps the complete actually fetched source, source URL, date, hash, month and previous measurement ID. Updating configuration can produce a separate measurement; previous results remain retained. Pausing or hiding its goal stops new measurements. A changed goal or configuration during the source read prevents filing stale progress. Measurements stay available through the command and do not create extra daily notifications.

## Adopted weekly comparison

Configure `comparison` only after the user adopts the actual agreed protocol. Supply `enabled:true`, `adopted:true`, adopted `goal_id`, visible `protocol_note_id`, and the existing `collection_id` containing the two actual output sides. Map `side_field`, `period_field` and `text_field` and name the two distinct values in `sides`. The text field contains each side's original output verbatim. These inputs must come from the actual systems or their existing imports; Mission Control never generates a substitute for a missing side.

`starts_at` is the exact ISO timestamp of the first agreed window. Subsequent windows start every seven elapsed days from that anchor. `cutoff_hours`, from 1 to 167, sets the agreed closing time within each window. This is an explicit fixed timestamp cadence, not an implied daylight-saving calendar promise. Each actual collection item names its window's exact ISO start in the mapped period field. More than one matching output for a side is ambiguous and fails for review.

The first check retains a randomly assigned A/B key under `work/lead-comparisons/` and commits that exact key to a separate private local Git repository. Its verified commit and content hash are retained in the comparison. This repository has no remote, uses no other workspace's staging area and publishes nothing. Backup and restoration retain the actual key file and comparison record; the Git object directory is a local diagnostic cache. A missing commit blocks filing rather than becoming a claimed successful comparison.

Missing sides remain explicitly waiting. Repeated unchanged checks stay quiet. A late actual side before the cutoff completes the same comparison and retains its earlier version. The cutoff closes missing sides honestly; an after-cutoff arrival does not rewrite that closed result. Outputs first observed after the cutoff are excluded. An edit after the cutoff cannot erase an output already accepted on time: retain its exact verified earlier record version and source hash. If that original version cannot be verified, stop for review. Hidden or withdrawn sources are not resurfaced through this fallback. Changing the protocol requires review. `/lead comparisons` exposes the private retained results; the `content` field is the A/B comparison draft and the key remains private. Do not publish the whole private record. Any external comparison page requires separate exact approval and a confirmed committed key before publication.

These duties run before the daily contribution cap and do not create additional automatic notifications. Their actual results and IDs are retained in the Lead run. Source checks demonstrate their implementation; normal installed use and useful real outcomes need their own evidence.
