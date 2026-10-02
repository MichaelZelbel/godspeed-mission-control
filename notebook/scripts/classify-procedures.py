import json,pathlib
root=pathlib.Path(__file__).resolve().parents[2]
inventory=json.loads((root/'docs/full-version/source-inventory.json').read_text())
mapping={
'sync':('superseded','file-sync','One file reconciler, every minute and after saves; no database-row sync.'),
'sync-bot':('superseded','file-sync','Bot and notebook use the same workspace; no second private clone.'),
'menerio-keepalive':('superseded','file-runtime','The file runtime needs no PowerSync service.'),
'paperclip-backup-prune':('separately owned','company','Paperclip is a separate company-agent system.'),
'snapshot-for-ownward':('separately owned','company','Company handovers remain with the owning company.'),
'ownward-handover':('separately owned','company','Company output is produced by its owning system.'),
'claude-upgrade':('superseded','candidate-update','Pinned candidate upgrades and rollback replace unpinned nightly runtime changes.'),
'hermes-backup-prune':('superseded','candidate-backup','Candidate upgrades retain verified backups; no private Hermes-home cleanup.'),
'kanbero-import':('optional connector','board-export','A chosen task-board connector reads work and receipts; no company agents are installed.'),
'browser-post':('optional connector','browser-post','Approved computer helper and explicit posting permission.'),
'spend-guard':('optional connector','spend-guard','Read a chosen provider balance; thresholds are configured by the owner.'),
'domain-watch':('optional connector','domain-watch','Read owner-selected authoritative domain registration endpoints; do not buy domains.'),
'health-table':('included','health-summary','Aggregate file-backed health observations, episodes and medication days.'),
'portfolio':('included','portfolio','Check owner-selected public links and save dated results.'),
'transcript-sync':('superseded','file-conversations','Conversation state and immutable snapshots are already durable files.'),
'prompt-harvest':('included','memory-capture','Capture explicitly supplied transcripts with credential redaction; never sweep other accounts.'),
'connections':('included','connection-check','Make a real read through each configured connector and save success or failure.'),
'due-check':('superseded','deadline-reminder','Independent deadline reminder and file-backed recurrence.'),
'topic-watch':('superseded','watch','One owner-selected topic registry and source reader.'),
'brief-judges':('included','brief-review','Judge the saved brief against current sources and voice; preserve critique.'),
'selftest':('included','selftest','Validate records, references, index and pending receipts.'),
'exa-monitor-test':('optional connector','watch','Optional search provider comparison uses dated source receipts.'),
'brief-morning':('included','morning-brief','Write from current user data; delivery is an explicitly configured connector.'),
'devops-bridge':('superseded','goal-work','Local assistant and durable work queue replace the private headless bridge.'),
'bot-probe':('included','conversation-review','Compare the last delivered message with its saved conversation record.'),
'job-check':('included','job-check','Detect failed, interrupted, missing or overdue routine receipts.'),
'work':('included','goal-work','Complete useful authorized work and save the actual deliverable.'),
'watch':('included','watch','Read selected sources, save observations and surface meaningful change.'),
'attention-pull':('included','attention-review','Prioritize near deadlines and prepared user actions; silence is valid.'),
'lead':('included','lead','Prepare a grounded post or reply; never publish automatically.'),
'memory-daily':('included','profiling','Source-quoted proposals go to the review queue.'),
'brief-rehearsal':('included','brief-review','Review saved source data without sending anything.'),
'radar':('included','radar','At most one evidence-based proposal from configured sources.'),
'memory-review':('included','memory-review','Propose stale or conflicting fact corrections without deleting knowledge.'),
'audit':('included','audit','Validate system state and goal outcomes, then prepare corrections.'),
'outside-ai-check':('included','memory-capture','Import owner-supplied conversations from other assistants; no account scraping.'),
'next-action':('included','goal-decision','Compare action, alternative and status quo using goals and actual outcomes.'),
'fresh-posts':('optional connector','lead','Read selected public sources or the explicitly paired browser; save observed posts, not invented ones.'),
'do-you-copy':('included','attention-review','One reminder for a pending approval, with durable deduplication.'),
'disk-watchdog':('included','disk-check','Read actual candidate filesystem free space without model usage.'),
}
rows=[]
for name in inventory['job_ids']:
 classification,operation,reason=mapping[name];rows.append(dict(name=name,classification=classification,operation=operation,reason=reason,activation='Owner enables a schedule; one declared runner; outward actions need a specific approval.'))
(root/'notebook/data/procedure-inventory.json').write_text(json.dumps(rows,indent=2)+'\n')
print('Classified',len(rows),'scheduled procedures')
