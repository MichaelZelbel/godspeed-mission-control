# Capability inventory

Every traced screen, domain, processing function, personal schedule and recipe has an explicit classification. Included means implemented in the candidate; optional means account/tool configuration is required. This matrix does not assert live-account verification. Lexicon and note graph are the only feature deferrals.

See verification.md for concrete evidence and the user-only trial boundary. Full source dependency evidence is source-inventory.json.

## Screens

| Item | Classification | Implementation and reason |
| --- | --- | --- |
| Notes | included | Reused upstream screen connected to file-backed APIs. |
| People | included | Reused upstream screen connected to file-backed APIs. |
| Profile | included | Reused upstream screen connected to file-backed APIs. |
| World | included | Reused upstream screen connected to file-backed APIs. |
| Collections | included | Reused upstream screen connected to file-backed APIs. |
| CollectionDetail | included | Reused upstream screen connected to file-backed APIs. |
| CollectionSchema | included | Reused upstream screen connected to file-backed APIs. |
| CollectionTemplates | included | Reused upstream screen connected to file-backed APIs. |
| TimelinePage | included | Reused upstream screen connected to file-backed APIs. |
| MediaLibrary | included | Reused upstream screen connected to file-backed APIs. |
| ReviewQueue | included | Reused upstream screen connected to file-backed APIs. |
| Groups | included | Reused upstream screen connected to file-backed APIs. |
| GroupDetail | included | Reused upstream screen connected to file-backed APIs. |
| WeeklyReview | included | Reused upstream screen connected to file-backed APIs. |
| Actions | included | Reused upstream screen connected to file-backed APIs. |
| ActivityPage | included | Reused upstream screen connected to file-backed APIs. |
| Dashboard | superseded | Integrated control desk: own runtime, privacy, keys, schedules, optional connectors, sync, pairing and recovery. |
| Settings | superseded | Integrated control desk: own runtime, privacy, keys, schedules, optional connectors, sync, pairing and recovery. |

## Domains

| Item | Classification | Implementation and reason |
| --- | --- | --- |
| action_items | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| activity_events | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| agent_instructions | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| ai_suggestion_preferences | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| ai_suggestion_suppressions | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| claims | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| collection_item_folders | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| collection_items | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| collection_templates | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| collections | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| connected_apps | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| contact_group_memberships | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| contact_groups | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| contact_interactions | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| contact_relationships | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| contact_topic_events | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| contact_topics | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| contacts | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| conversation_messages | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| discord_connections | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| dismissed_suggestions | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| entities | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| fact_slots | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| gdrive_connections | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| gdrive_imports | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| github_connections | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| github_sync_log | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| godspeed_connections | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| group_briefings | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| mcp_api_tokens | superseded | Cloud roles and billing are unnecessary for a single owner; API keys are hash-only device files. |
| mcp_preferences | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| media_analysis | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| moment_entities | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| moment_participants | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| moment_provenance | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| moments | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| note-attachments | superseded | Storage bucket is the SHA-checked local media service, not a record table. |
| note_ai_jobs | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| note_attachments | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| note_connections | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| note_folders | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| notes | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| notification_preferences | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| person_documents | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| profile_categories | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| profile_facts | included | Derived directly from dated source claims, relationships, entities and append-only events; no second authoritative database. |
| profile_views | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| profiles | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| relationship_evidence | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| relationship_rejections | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| review_queue | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| review_queue_bulk_jobs | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| shared_notes | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| telegram_connections | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| user_mcp_servers | optional connector | Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts. |
| user_roles | superseded | Cloud roles and billing are unnecessary for a single owner; API keys are hash-only device files. |
| user_self_aliases | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| v_ai_allowance_current | superseded | Cloud roles and billing are unnecessary for a single owner; API keys are hash-only device files. |
| weekly_reviews | included | Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable. |
| wiki_page_sources | deferred | Permitted lexicon deferral; existing imported records remain preservable. |
| wiki_pages | deferred | Permitted lexicon deferral; existing imported records remain preservable. |
| wiki_revisions | deferred | Permitted lexicon deferral; existing imported records remain preservable. |
| world_claims | included | Derived directly from dated source claims, relationships, entities and append-only events; no second authoritative database. |
| world_entities | included | Derived directly from dated source claims, relationships, entities and append-only events; no second authoritative database. |
| world_events | included | Derived directly from dated source claims, relationships, entities and append-only events; no second authoritative database. |

## Functions

| Item | Classification | Implementation and reason |
| --- | --- | --- |
| analyze-media | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| backfill-metadata | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| backfill-moment-profile-extraction | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| backfill-profile-extraction | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| backfill-wikilinks | deferred | Permitted lexicon/note graph deferral. |
| classify-profile-fact | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| collection-chat | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| compute-connections | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| conversation-chat | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| delete-my-account | superseded | Local owner and own-provider policy replaces cloud account deletion, credit allowance and platform moderation. |
| draft-event | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| embed-document | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| enrich-people | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| enrich-person-from-lexicon | deferred | Permitted lexicon/note graph deferral. |
| ensure-token-allowance | superseded | Local owner and own-provider policy replaces cloud account deletion, credit allowance and platform moderation. |
| extract-moment-profile | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| find-connections | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| gdrive-proxy | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| gdrive-sync | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| generate-profile-suggestions | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| generate_collection_schema | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| get-graph-data | deferred | Permitted lexicon/note graph deferral. |
| github-import-vault | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| github-people-sync | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| github-proxy | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| github-sync-export | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| github-sync-pull | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| mc-api-keys | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| mc-api-keys/generate | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| merge-contacts | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| moderate-content | superseded | Local owner and own-provider policy replaces cloud account deletion, credit allowance and platform moderation. |
| normalize-profile | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| note-chat | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| process-note | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| profile-lint | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| quick-capture | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| review-queue-bulk | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| search-notes-semantic | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| send-patch | optional connector | Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action. |
| suggest-connections | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| suggest-group-members | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| suggest-group-next-step | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| weekly-review | included | File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion. |
| wiki-ingest | deferred | Permitted lexicon/note graph deferral. |

## Procedures

| Item | Classification | Implementation and reason |
| --- | --- | --- |
| sync | superseded | One file reconciler, every minute and after saves; no database-row sync. |
| sync-bot | superseded | Bot and notebook use the same workspace; no second private clone. |
| browser-post | optional connector | Approved computer helper and explicit posting permission. |
| kanbero-import | optional connector | A chosen task-board connector reads work and receipts; no company agents are installed. |
| spend-guard | optional connector | Read a chosen provider balance; thresholds are configured by the owner. |
| do-you-copy | included | One reminder for a pending approval, with durable deduplication. |
| menerio-keepalive | superseded | The file runtime needs no PowerSync service. |
| disk-watchdog | included | Read actual candidate filesystem free space without model usage. |
| paperclip-backup-prune | separately owned | Paperclip is a separate company-agent system. |
| domain-watch | optional connector | Read owner-selected authoritative domain registration endpoints; do not buy domains. |
| claude-upgrade | superseded | Pinned candidate upgrades and rollback replace unpinned nightly runtime changes. |
| health-table | included | Aggregate file-backed health observations, episodes and medication days. |
| portfolio | included | Check owner-selected public links and save dated results. |
| transcript-sync | superseded | Conversation state and immutable snapshots are already durable files. |
| fresh-posts | optional connector | Read selected public sources or the explicitly paired browser; save observed posts, not invented ones. |
| next-action | included | Compare action, alternative and status quo using goals and actual outcomes. |
| prompt-harvest | included | Capture explicitly supplied transcripts with credential redaction; never sweep other accounts. |
| snapshot-for-ownward | separately owned | Company handovers remain with the owning company. |
| connections | included | Make a real read through each configured connector and save success or failure. |
| due-check | superseded | Independent deadline reminder and file-backed recurrence. |
| topic-watch | superseded | One owner-selected topic registry and source reader. |
| brief-judges | included | Judge the saved brief against current sources and voice; preserve critique. |
| ownward-handover | separately owned | Company output is produced by its owning system. |
| selftest | included | Validate records, references, index and pending receipts. |
| exa-monitor-test | optional connector | Optional search provider comparison uses dated source receipts. |
| brief-morning | included | Write from current user data; delivery is an explicitly configured connector. |
| devops-bridge | superseded | Local assistant and durable work queue replace the private headless bridge. |
| bot-probe | included | Compare the last delivered message with its saved conversation record. |
| hermes-backup-prune | superseded | Candidate upgrades retain verified backups; no private Hermes-home cleanup. |
| job-check | included | Detect failed, interrupted, missing or overdue routine receipts. |
| work | included | Complete useful authorized work and save the actual deliverable. |
| watch | included | Read selected sources, save observations and surface meaningful change. |
| attention-pull | included | Prioritize near deadlines and prepared user actions; silence is valid. |
| lead | included | Prepare a grounded post or reply; never publish automatically. |
| memory-daily | included | Source-quoted proposals go to the review queue. |
| brief-rehearsal | included | Review saved source data without sending anything. |
| radar | included | At most one evidence-based proposal from configured sources. |
| memory-review | included | Propose stale or conflicting fact corrections without deleting knowledge. |
| audit | included | Validate system state and goal outcomes, then prepare corrections. |
| outside-ai-check | included | Import owner-supplied conversations from other assistants; no account scraping. |

## Recipes

| Item | Classification | Implementation and reason |
| --- | --- | --- |
| audit | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| book-title-creator | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| book-title-strategist | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| browser-post | optional connector | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| coach | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| connect-email | optional connector | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| daily-brief | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| due | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| embedded-captions | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| excalidraw-diagram | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| excalidraw-visuals | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| faceless-explainer | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| figma | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| found-company | separately owned | Company and specialist enterprise-agent systems remain separate from personal Mission Control. |
| general-video | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| grill-me | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| gsap-core | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| gsap-timeline | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| headache-tracker | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| hyperframes | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-animation | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-audio | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-cli | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-core | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-creative | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-keyframes | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| hyperframes-registry | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| interstitial-journal | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| keep-a-note | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| lead | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| mc-brief-operations | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| mc-radar | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| media-use | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| memory-audit | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| morning-note | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| motion-graphics | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| move-godspeed | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| music-to-video | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| nano-banana-images | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| next-action | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| pattern1-build | separately owned | Company and specialist enterprise-agent systems remain separate from personal Mission Control. |
| phone-errands | optional connector | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| pr-to-video | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| product-launch-video | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| remotion-to-hyperframes | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| sap-ai-agent-low-code | separately owned | Company and specialist enterprise-agent systems remain separate from personal Mission Control. |
| sap-ai-agent-pro-code | separately owned | Company and specialist enterprise-agent systems remain separate from personal Mission Control. |
| sap-build-ai-patterns | separately owned | Company and specialist enterprise-agent systems remain separate from personal Mission Control. |
| scroll-craft | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| slideshow | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| social-visuals | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| strip-ai-tells | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| subscription-review | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| talk-about | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| talking-head-recut | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| video-captions | optional connector | Portable recipe with local file contract; chosen media/service provider is configured separately. |
| video-finishing | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| video-hooks | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| watch | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| web-design | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |
| work-item | included | Portable recipe and shared record/runtime operations; no private incident prose or account details. |

## Activation and boundaries

All knowledge is local files. Optional provider calls, read-only accounts, phone/video toolchains and browser posting require the owner's configuration. Company desks and specialist enterprise systems are separately owned. Starter procedures are portable versions, not copies of personal incident histories. Existing production, live data and stable channels are untouched.
