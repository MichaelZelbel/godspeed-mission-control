# Final whole-branch review

Reviewed 4 October 2026. Product range: `136dcacef66a03a69560bdf5bd80ea3ea3e4c5b3..03459f95ed63e16b12297cd43abae4145761a756`. Bootstrap: `0d10f08a02599c79d1c86b27f0cd03f64d72c731`. Both HEADs were read and confirmed. This is the single requested final review, with no subsidiary reviewers.

## Scope and strengths

Applied the seven core outcomes in the first-version product contract and the narrowed trial scope. The actual Teach It Once manuscript calls video finishing an optional Part VI extra. Full required notebook functionality remains inside the trial boundary.

The implementation has substantive controls: remote notebook sessions and single-use login links; a separate exact-target permission for local goal edits; actual controlled source reads and a separate semantic completion check; scheduler owner checks and retained uncertain attempts; file transactions, version history and stale-write conflicts; background index reads; separate backup/restoration workers and a disk-space check before destination creation. Ordinary chat now returns actual persisted note receipts. These are working implementation paths rather than only prompt instructions.

The progress ledger now records matching Windows and development installations, normal recovery and chat evidence, and the frozen 345-test suites with 344 passes and one platform skip on each platform. I read that evidence; I did not independently rerun those suites or access either installation. Historical pending lines are not treated as current failures.

## Findings

### Important: P1. Collection chat overwrites edits made while the model is working

- Location: `notebook/core/domains.mjs:278-281`; upstream `notebook/core/chat-context.mjs:40,58`; conflict condition `notebook/core/query.mjs:149`.
- `context.items` contains compacted prompt records. The compactor omits `_hash`, but the mutation path uses `old._hash` from that compacted record as its expected version. The query layer checks only a truthy expected hash. It also writes the whole `data` object assembled from this stale prompt copy.
- Reproduction: a row starts as `{name:"Item",status:"old"}`. Ask collection chat to change its name. During the provider call, save `{name:"Item",status:"newer human edit"}`. The provider returns only `{name:"Renamed"}`. The final row becomes `{name:"Renamed",status:"old"}` with a successful tool receipt and no conflict.
- I executed this sequence through the actual `Domains`, `chatContext` and `QueryService` code with an in-memory storage adapter. It returned precisely that lost-update result. No workspace files were created by the probe.
- Fix: retain a complete authoritative row snapshot and hash separately from bounded prompt text. Require its version at commit and refuse a stale update. Do not use compacted `data` for persistence: the compactor can also turn oversized structured data into a truncated JSON string.
- Regression: the concurrent edit above must be preserved or produce a saved conflict. Include a row whose data exceeds the prompt budget and verify untouched fields remain intact.

### Important: P1. Generic MCP writes bypass hidden-record access and required edit versions

- Location: `notebook/server/mcp.mjs:60`; related generic mutation at `:65`; scope mapping `notebook/core/api-keys.mjs:23-24`; version check `notebook/core/query.mjs:149`.
- `get_note` and `update_note` enforce visibility, and `update_note` requires a current hash. `save_record` goes straight to the generic query service. An existing ID without `expected_hash` becomes an unrestricted upsert whose result contains the full old record. The HTTP scope check allows this call for a key with the `notes` scope.
- Reproduction: retain the ID of a formerly visible note, then mark it `ai_visibility:"hidden"`. A notes-scoped assistant calls `save_record` with `{type:"notes",value:{id:"formerly-visible-note"}}`. It receives the hidden title and full content, despite supplying no expected hash. It can similarly overwrite the note. Knowing a prior ID is sufficient; no authentication bypass is needed.
- Executed the actual MCP, scope mapping and query code against an in-memory record. The result included `Fictional private content` and the hidden marker, with no tool error. The HTTP gate was inspected and requests exactly the already-granted `notes` scope.
- Fix: apply the same current visibility and existence checks to all assistant mutation paths, including structural operations and linked targets. Require a current nonempty hash for updating an existing record. Keep the owner's authenticated notebook correction path distinct from the assistant-facing privacy restriction.
- Regression: after a record or its owning person/collection is hidden, a previously authorized scoped assistant must fail to read it indirectly, overwrite it, or unhide it through generic mutation. An omitted update hash must fail.

### Important: P1. Review rollback can report success without reversing the accepted memory change

- Locations: `notebook/core/domains.mjs:132-135`; `notebook/core/review.mjs:13-15,35-44`; prior claim closure at `notebook/core/domains.mjs:37-41`.
- Individual Keep for a profile suggestion uses `normalize-profile/accept_profile_entry`. That path creates the claim and marks the review kept but saves neither `applied_targets` nor `target_entity_id`. Bulk rollback then loops over an empty target list, marks the review removed and counts success while the accepted fact remains current. The individual UI rollback also exits early without a target.
- A second case affects the bulk path: replacing a single-valued fact closes its previous claim, but the rollback record captures only the newly inserted claim. Undo removes the new claim and leaves the earlier claim closed, rather than restoring the previous state.
- Executed both sequences through the actual domain/query/review code with in-memory storage. Individual Keep followed by bulk rollback returned `succeeded:1`, while `Town B` remained current. Starting with `Town A`, then bulk-keeping `Town B` and rolling it back, left no current home-city fact.
- Fix: use one apply path for individual and bulk review. Save the complete change set, including prior claim closures and slot changes, with before state and after hashes. Validate the whole change set before undoing any part; refuse later-edited targets without partially reverting other targets. A missing legacy rollback receipt must produce an honest refusal, not success.
- Regression: Keep and Undo must behave the same from individual and bulk controls; replacing a current value and undoing restores it; later edits remain untouched; an applied item missing undo evidence is not reported as rolled back.

### Important: P2. Review queue controls disagree with the backend contract

- Locations: `notebook/ui/src/pages/ReviewQueue.tsx:893-918`; `notebook/core/review.mjs:47,59`; UI counters at `ReviewQueue.tsx:867-887`; target convention at `notebook/core/review.mjs:33` and `notebook/ui/src/lib/review-fact-revert.ts:48`.
- The visible bulk Never Again control sends `action:"never_again"`; the backend accepts `block` or `reject` and throws `Choose a review action`. The adapter forwards this unchanged. An in-memory call with the exact UI payload reproduced that error.
- Bulk jobs save `processed` and `succeeded`, while the UI reads `done`, so a successful job is displayed as zero changes. Bulk fact Keep also saves target type `claims`, while the individual rollback helper accepts only `claim`, preventing that control from undoing a bulk-kept fact.
- Fix: align the retained UI and local backend vocabulary, including action names, counts and target types. Prefer a single review operation for individual and bulk flows so the P1 rollback correction is exercised by the visible controls.
- Regression: use the actual UI payloads for Never Again, Keep and Roll Back; assert suppression persists, displayed counts match actual changes and a bulk-kept fact can be addressed by individual Undo.

No additional Critical or Minor findings are asserted. The P1 labels reflect demonstrated privacy or edit-preservation failures, not an unverified production incident.

## Coverage and limits

Read the product/completeness requirements, narrowed trial scope, manuscript scope passage, progress ledger, SDD progress and stopped optional-video report. Reviewed selected meaningful first-party paths in several passes across the large branch: notebook HTTP authentication/session/CSRF and scope gates; MCP reads and writes; provider budgets and controlled worker; goal decision/work/verification; scheduler ownership, claims, retry and pause controls; personal operations and conversational authorization; chat capture truth and source context; storage identity, locking, history, transactions and recovery; Git/media sync and saved conflicts; backup manifests, disk guard and restoration; index generations; claims/profile views, collections, review queue, timeline corrections, media and comments; local onboarding/control UI; isolated Windows setup, Docker entrypoint and assistant wiring. Inspected representative associated regression tests, including parity and review tests, to assess coverage of the reported cases.

The 29 MB package comprises more than half a million inserted lines across 3182 files. This was risk-directed source review, not a line-by-line review of every imported UI, recipe, dependency or generated asset. In-memory reproductions exercised real application logic while replacing disk storage operations; they are not browser, filesystem-transaction or installed-provider acceptance tests. The only review write is this ignored report. No source/index/HEAD mutation, live fixture creation, server access, network action or production access occurred. Parent-owned documentation edits were observed and left intact.

## Declined to judge

- Full embedded/video rendering and other inherited creative recipe completion: expressly excluded from the core trial by Michael; retained stopped-work evidence is not a completed-work claim.
- Every imported screen/control and generated bundle byte: full source enumeration would exceed this bounded final review; inspected the core adapters and meaningful visible flows, with concrete mismatches reported above.
- Third-party internals, vendored native binaries and generated assets: not independently audited; package and suite correspondence relies on the recorded exact-source evidence.
- Mac acceptance: no independent Mac evidence here and separate from this supported trial decision.
- Live Menerio retirement/migration, production replacement, publication and private company workflows: outside this authorized isolated trial and no production access allowed.
- Two-week user outcomes and measured health/work/relationship benefit: cannot be established by implementation review; the trial must supply that evidence.
- Optional connector behavior beyond the read access/permission boundaries inspected: not a core trial blocker and not claimed fully verified.

## Assessment

**Trial readiness: with fixes. Do not call this version ready for the core trial until the four findings above are corrected and checked.**

The source and recorded installed evidence support beginning a bounded trial after one focused fix wave. These findings affect required collections, memory review and privacy controls. They do not justify restarting optional workflow testing or claiming exhaustive feature completeness. Verify the concrete regression triggers and matching corrected packages; a second whole-branch review is not requested.

## Reproduction harness and captured outputs

The following adapter was used with the actual imported application classes. It changes only an in-memory Map, never disk. Run as Node ESM from the product root; the `Domains`, `QueryService`, `chatContext` and MCP imports resolve their normal product implementations.

```js
import {Store, encode, hash} from './notebook/core/records/store.mjs';
import {QueryService} from './notebook/core/query.mjs';
import {Domains} from './notebook/core/domains.mjs';
import {chatContext} from './notebook/core/chat-context.mjs';
import {mcp} from './notebook/server/mcp.mjs';
import {toolScope} from './notebook/core/api-keys.mjs';
function memoryStore() {
  const s = Object.create(Store.prototype);
  Object.assign(s, {
    root: 'C:/__nonexistent_review_fixture_read_only__', device: 'local',
    records: new Map(), scan() { return this.records; },
    withLock(fn) { return fn(); }, async waitForWriter() {},
    commit(rows) {
      for (const row of rows) this.records.set(row.type + '/' + row.id,
        {...structuredClone(row), _hash: hash(encode(row))});
    },
    conflict() { throw Error('CONFLICT'); }
  });
  s.saveAsync = async (...args) => s.save(...args);
  return s;
}
const s = memoryStore(), q = new QueryService(s), d = new Domains(q);
const c = s.save('collections', {name:'Trial', field_schema:[
  {key:'name',label:'Name',type:'text',primary:true},
  {key:'status',label:'Status',type:'text'}]});
const item = s.save('collection_items', {
  collection_id:c.id, data:{name:'Item',status:'old'}});
d.provider = async () => {
  s.save('collection_items', {
    id:item.id, data:{name:'Item',status:'newer human edit'}});
  return {reply:'Changed the name.',
    item_updates:[{id:item.id,data:{name:'Renamed'}}]};
};
console.log('context hash', chatContext(q, {
  collection_id:c.id,message:'Change the name'}).items[0]._hash);
await d.invoke('collection-chat', {collection_id:c.id,message:'Change the name'});
console.log('final row', s.get('collection_items',item.id).data);
s.save('notes', {id:'formerly-visible-note',title:'Private',
  content:'Fictional private content',ai_visibility:'hidden'});
const args = {type:'notes',value:{id:'formerly-visible-note'}};
console.log('required scope', toolScope('save_record',args));
console.log(await mcp({jsonrpc:'2.0',id:1,method:'tools/call',
  params:{name:'save_record',arguments:args}},
  {store:s,query:q,domains:d,scopes:['notes']}));
for (const individual of [true,false]) {
  const store=memoryStore(), query=new QueryService(store), domains=new Domains(query);
  domains.writeFact({label:'Home city',attribute:'home_city',
    value:'Town A',valid_from:'2026-01-01'});
  const review=store.save('review_queue', {suggestion_type:'add_profile_entry',
    status:'pending_review',payload:{label:'Home city',attribute:'home_city',
      value:'Town B',valid_from:'2026-10-01'}});
  if (individual) await domains.invoke('normalize-profile', {
    action:'accept_profile_entry',review_id:review.id});
  else await domains.invoke('review-queue-bulk', {
    action:'keep',scope:{ids:[review.id]}});
  console.log('rollback', individual, await domains.invoke('review-queue-bulk', {
    action:'rollback',scope:{ids:[review.id]}}));
  console.log('current', query.rows('profile_facts').filter(x=>x.is_current).map(x=>x.value));
}
try { await d.invoke('review-queue-bulk',{action:'never_again',scope:'all'}); }
catch (e) { console.log('Never Again:',e.message); }
```

Captured results from these same sequences, omitting random record IDs and timestamps:

```text
context row hash undefined
collection row after competing edit { name: 'Renamed', status: 'old' }
route-required scope: notes
MCP result.content[0].text includes:
  "content":"Fictional private content","ai_visibility":"hidden","revision":2
  (no isError)
individual accept rollback metadata: status=kept, applied_at present,
  applied_targets absent, target_entity_id absent
bulk rollback after individual accept:
  processed=1, succeeded=1, errors=[], current facts=['Town B']
current facts after keep-all then rollback: []
UI bulk never_again: Choose a review action
```

The fix worker should translate these cases into actual temporary-file regression tests and verify the visible review controls. Source history and final package checks already recorded by the parent are additional evidence, not replacements for these specific checks. I remain available for a scoped check of the resulting fix wave; it does not expand this into another whole-branch review.
