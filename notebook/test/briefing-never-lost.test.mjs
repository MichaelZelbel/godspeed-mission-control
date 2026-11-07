import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';
import {addonCommand} from '../core/native-personal.mjs';

// A morning briefing is never lost because of one sentence (issue #117). All data is made up.
const OK='No fresh health observations are recorded. Review the fictional list today.';
function fixture(rules,{charm=false}={}){
 process.env.GODSPEED_CHARM_NOW='2026-10-21T08:00:00Z';process.env.GODSPEED_NOW='2026-10-21T08:00:00Z';
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-never-lost-'))),query=new QueryService(store);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 fs.mkdirSync(path.join(store.root,'profile'),{recursive:true});
 fs.writeFileSync(path.join(store.root,'profile','voice.md'),'# Voice\n\n```voice-rules\n'+rules.join('\n')+'\n```\n');
 if(charm)addonCommand(store,{addon:'charm',args:['start']});
 return {store,query};
}
const verifies=input=>input.kind==='brief-verification'?{passed:true,reason:'Fictional sources checked.'}:null;
const run=(provider,query,store,id)=>jobExecutor(provider,query)({kind:'morning-brief',id},{store,settings:{}});
const repairs=query=>query.rows('work_items').filter(w=>w.kind==='repair');
const reviewFailure=(input,scope='non-source',ids=[])=>input.check==='source-facts'?{passed:true,reason:'Fictional facts checked.'}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:scope,rejected_source_ids:ids};
test.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_NOW;});

test('a delivery review rejection after the rewrite saves a checked factual briefing and repair',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?reviewFailure(input):'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-fallback'),saved=store.get('notes',result.record_id);
 assert.equal(result.fallback,true);assert.equal(query.rows('notes').filter(note=>note.source_app==='morning-brief').length,1);
 assert.match(saved.content,/Prepare a fictional guide/);assert.doesNotMatch(saved.content,/Rejected private model prose/);
 const receipt=query.rows('job_receipts').find(row=>row.kind==='brief-factual-fallback');
 assert.equal(receipt.state,'verified');assert.equal(receipt.rejected_draft,'Rejected private model prose.');
 assert.equal(repairs(query).filter(row=>row.note_id===saved.id).length,1);
});

test('a factual fallback retains the Charm line and checked contribution after non-source review failure',async()=>{
 const {store,query}=fixture([],{charm:true}),content='Fictional copy ready draft.';
 const note=store.save('notes',{title:'Fictional contribution',content});store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?reviewFailure(input):'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-charm'),saved=store.get('notes',result.record_id).content;
 const line=JSON.parse(addonCommand(store,{addon:'charm',args:['brief','--no-write']}).result).reply;
 assert.ok(saved.split(/\r?\n/).includes(line));assert.match(saved,/Fictional copy ready draft/);assert.match(saved,new RegExp('/dashboard/notes/'+note.id));
});

test('a source claim rejected by id is absent from the factual fallback',async()=>{
 const {store,query}=fixture([]);const goal=store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?input.check==='source-facts'?{passed:false,reason:'This goal is not current.',rejection_scope:'source-claims',rejected_source_ids:[goal.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}:'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-rejected-source'),saved=store.get('notes',result.record_id).content;
 assert.doesNotMatch(saved,/Prepare a fictional guide/);
 const receipt=query.rows('job_receipts').find(row=>row.kind==='brief-factual-fallback');assert.deepEqual(receipt.rejected_source_ids,[goal.id]);
});

for(const check of ['source-facts','plain-words-and-delivery'])test('a '+check+' source-claim rejection excludes its record',async()=>{
 const {store,query}=fixture([]);const goal=store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?(input.check===check?{passed:false,reason:'This goal is not current.',rejection_scope:'source-claims',rejected_source_ids:[goal.id]}:{passed:true,reason:'Fictional review passed.'}):'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-'+check),saved=store.get('notes',result.record_id).content;
 assert.doesNotMatch(saved,/Prepare a fictional guide/);
});

for(const check of ['source-facts','plain-words-and-delivery'])test('a '+check+' non-source rejection permits a factual fallback',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?(input.check===check?{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}:{passed:true,reason:'Fictional review passed.'}):'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-non-source-'+check);
 assert.equal(result.fallback,true);
});

test('a factual fallback uses visible facts, not hidden or sensitive records',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});store.save('goals',{title:'Hidden fictional goal',status:'adopted',ai_visibility:'hidden'});
 store.save('health_observations',{metric:'Fictional visible energy',value:6,observed_at:new Date().toISOString()});store.save('health_observations',{metric:'Hidden fictional mood',value:3,observed_at:new Date().toISOString(),ai_visibility:'hidden'});store.save('health_observations',{metric:'Sensitive fictional symptom',value:4,observed_at:new Date().toISOString(),is_sensitive:true});
 const provider=async input=>input.kind==='brief-verification'?reviewFailure(input):'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-visible'),saved=store.get('notes',result.record_id).content;
 assert.match(saved,/Fictional visible energy: 6/);assert.doesNotMatch(saved,/Hidden fictional|Sensitive fictional/);
});

test('an unsafe factual fallback remains unsent with its rejected draft receipt',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Godspeed','BANNED-WORD: goal','BANNED-WORD: Tell','BANNED-WORD: one','BANNED-WORD: work','BANNED-WORD: today','BANNED-WORD: first','BANNED-WORD: concrete','BANNED-WORD: step']);
 const provider=async input=>input.kind==='brief-verification'?reviewFailure(input):'Rejected private model prose.';
 await assert.rejects(run(provider,query,store,'brief-factual-unsafe'),/Could not make a checked factual fallback/);
 assert.equal(query.rows('notes').filter(note=>note.source_app==='morning-brief').length,0);
 const receipt=query.rows('job_receipts').find(row=>row.kind==='brief-factual-fallback');assert.equal(receipt.state,'failed');assert.equal(receipt.rejected_draft,'Rejected private model prose.');
});

test('a required line with a banned word is left out and reported, and the briefing is saved',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Challenge'],{charm:true});let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;assert.equal(input.context.charm_line,null);return OK;};
 const result=await run(provider,query,store,'brief-banned-line');
 const saved=store.get('notes',result.record_id);
 assert.equal(writes,1);assert.equal(saved.content,OK);assert.ok(!/Challenge/.test(saved.content));
 assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,1);
 const items=repairs(query);assert.equal(items.length,1);assert.equal(items[0].state,'needs_review');
 assert.equal(items[0].line_name,'the Charm Challenge line');assert.match(items[0].line,/^Charm Challenge: day/);
 assert.ok(items[0].refusals.some(r=>r.rule==='BANNED-WORD'&&r.value==='Challenge'));
 assert.deepEqual(result.left_out,['the Charm Challenge line']);
});

test('a required sentence over the length limit is left out and reported, and the briefing is saved',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 8']);
 const content='This fictional copy ready sentence is far too long for the limit set here.',note=store.save('notes',{title:'Fictional contribution',content}),entry=store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>{const v=verifies(input);if(v)return v;assert.equal(input.context.contribution,null);return OK;};
 const result=await run(provider,query,store,'brief-long-line');
 assert.equal(store.get('notes',result.record_id).content,OK);
 assert.equal(store.get('lead_entries',entry.id).status,'ready');
 const items=repairs(query);assert.equal(items.length,1);assert.equal(items[0].line_name,'the checked contribution');
 assert.ok(items[0].refusals.some(r=>r.rule==='MAX-SENTENCE-WORDS'));
});

test('a rewrite that still breaks one rule loses that sentence, not the briefing',async()=>{
 const {store,query}=fixture(['BANNED-WORD: realm']);let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;return 'No fresh health observations are recorded. Your realm is open today. Review the fictional list today.';};
 const result=await run(provider,query,store,'brief-one-sentence');
 const saved=store.get('notes',result.record_id);
 assert.equal(writes,2);assert.equal(saved.content,'No fresh health observations are recorded. Review the fictional list today.');
 assert.equal(saved.fallback,undefined);assert.equal(repairs(query).length,0);
 const cut=query.rows('job_receipts').filter(r=>r.kind==='brief-cut');
 assert.equal(cut.length,1);assert.equal(cut[0].state,'verified');assert.equal(cut[0].cut.length,1);assert.match(cut[0].cut[0].sentence,/realm/);
 assert.equal(saved.cut_receipt_id,cut[0].id);assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,1);
});

test('a draft where every sentence breaks a rule sends the short fallback and opens a repair item',async()=>{
 const {store,query}=fixture(['BANNED-WORD: realm']);let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;return 'Your realm is open today. The realm of your list waits.';};
 const result=await run(provider,query,store,'brief-all-broken');
 const saved=store.get('notes',result.record_id);
 assert.equal(writes,2);assert.equal(result.fallback,true);assert.equal(saved.fallback,true);
 assert.match(saved.content,/could not be written/);assert.ok(!/realm/i.test(saved.content));
 assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,1);
 const items=repairs(query);assert.equal(items.length,1);assert.equal(items[0].state,'needs_review');
 assert.equal(items[0].note_id,saved.id);assert.match(items[0].title,/morning briefing/);
 assert.ok(items[0].refusals.some(e=>/voice check failed: realm/.test(e)));
});

test('a sentence that becomes the first one after a cut is judged as an opener too',async()=>{
 const {store,query}=fixture(['BANNED-WORD: realm','BANNED-OPENER: Please']);let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;return 'Your realm is open today. Please review the fictional list today. A useful closing remains.';};
 const result=await run(provider,query,store,'brief-new-opener');
 const saved=store.get('notes',result.record_id);
 assert.equal(writes,2);assert.equal(saved.content,'A useful closing remains.');assert.equal(saved.fallback,undefined);
 assert.equal(repairs(query).length,0);
});

test('a required line that opens with a banned opener is left out and reported, and the briefing is saved',async()=>{
 const {store,query}=fixture(['BANNED-OPENER: Charm'],{charm:true});let writes=0;
 const provider=async input=>{const v=verifies(input);if(v)return v;writes++;assert.equal(input.context.charm_line,null);return OK;};
 const result=await run(provider,query,store,'brief-banned-opener-line');
 const saved=store.get('notes',result.record_id);
 assert.equal(writes,1);assert.equal(saved.content,OK);assert.equal(saved.fallback,undefined);
 const items=repairs(query);assert.equal(items.length,1);assert.equal(items[0].line_name,'the Charm Challenge line');
 assert.ok(items[0].refusals.some(r=>r.rule==='BANNED-OPENER'));
});
