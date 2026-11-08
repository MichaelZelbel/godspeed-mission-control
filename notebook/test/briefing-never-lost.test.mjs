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
const readerFails=(input,reason)=>input.check==='source-facts'?{passed:true,reason:'Fictional sources checked.'}:{passed:false,reason,rejection_scope:'non-source',rejected_source_ids:[]};
const sourceRejects=(input,reason,ids)=>input.check==='source-facts'?{passed:false,reason,rejection_scope:'source-claims',rejected_source_ids:ids}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]};
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
 assert.doesNotMatch(saved,/Prepare a fictional guide|goal step/);assert.match(saved,/Tell Godspeed one goal/);
 const receipt=query.rows('job_receipts').find(row=>row.kind==='brief-factual-fallback');assert.deepEqual(receipt.rejected_source_ids,[goal.id]);
});

test('a factual fallback honestly reports absent health when every health source is rejected',async()=>{
 for(const phone of [false,true]){
  const {store,query}=fixture([]),now=new Date(),observation=store.save('health_observations',phone?{metric:'steps',value:4200,source:'Health Auto Export',via:'phone-receiver',observed_on:now.toISOString().slice(0,10),date_precision:'day',observed_at:now.toISOString(),data_until:'08:00:00'}:{metric:'Fictional energy',value:6,observed_at:now.toISOString()});
  const provider=async input=>input.kind==='brief-verification'?input.check==='source-facts'?{passed:false,reason:'This health source is not current.',rejection_scope:'source-claims',rejected_source_ids:[observation.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}:'Rejected private model prose.';
  const result=await run(provider,query,store,'brief-factual-rejected-health-'+phone),saved=store.get('notes',result.record_id).content;
  assert.match(saved,/There are no fresh health observations to report/);
  assert.doesNotMatch(saved,/Fictional energy|steps: 4200|4200 so far/);
 }
});

test('a source-rejected checked contribution is absent and remains ready',async()=>{
 const {store,query}=fixture([]),content='Fictional checked contribution to exclude.',note=store.save('notes',{title:'Fictional contribution',content}),entry=store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?input.check==='source-facts'?{passed:false,reason:'This contribution is not current.',rejection_scope:'source-claims',rejected_source_ids:[entry.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}:'Rejected private model prose.';
 const result=await run(provider,query,store,'brief-factual-rejected-contribution'),saved=store.get('notes',result.record_id).content;
 assert.doesNotMatch(saved,/Fictional checked contribution to exclude|\/dashboard\/notes\//);
 assert.equal(store.get('lead_entries',entry.id).status,'ready');
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
 const receipt=query.rows('job_receipts').find(row=>row.kind==='brief-factual-fallback');assert.equal(receipt.state,'failed');assert.equal(receipt.rejected_draft,'Rejected private model prose.');assert.equal(receipt.all_reasons.length,2);
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

for(const [name,reason] of [['missing health sentence','No health sentence'],['no actionable next step','No useful next action']])test('a rejected rewrite for '+name+' saves a factual brief',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 let writes=0;
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,reason):++writes&&'Private unsupported claim: the guide sold 100 copies.';
 const result=await run(provider,query,store,'brief-failed-'+name.replaceAll(' ','-'));
 const note=store.get('notes',result.record_id);
 assert.equal(writes,2);assert.equal(result.fallback,true);assert.match(note.content,/Prepare a fictional guide/);
 assert.match(note.content,/Ask Godspeed to work on/);assert.match(note.content,/no fresh health observations/i);
 assert.doesNotMatch(note.content,/Private|100 copies/);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.match(receipt.rejected_draft,/100 copies/);assert.ok(receipt.reasons.includes(reason));
 assert.equal(repairs(query).length,1);assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,1);
});

test('a voice rule that rejects the goal title still leaves a useful action',async()=>{
 const {store,query}=fixture(['BANNED-WORD: guide']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-voice-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Ask Godspeed to complete one goal step/);assert.doesNotMatch(content,/guide/i);
});

test('a short sentence limit still yields a concrete action',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 8']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-short-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Ask Godspeed to complete one goal step/);
});

test('a five-word sentence limit still yields an action with a saved goal',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 5']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-five-word-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Do one goal step\./);
});

test('a voice rule against the product name still leaves a goal action',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Godspeed']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-no-name-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Work on one goal step today/);assert.doesNotMatch(content,/Godspeed/);
});

test('a long saved goal is not mistaken for missing setup',async()=>{
 const {store,query}=fixture([]),title='Prepare the fictional field guide to coastal lighthouses and ship it to every subscriber before the fictional winter season begins';
 store.save('goals',{title,status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-long-goal'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Prepare the fictional field guide/);assert.doesNotMatch(content,/Tell Godspeed one goal/);
});

test('an empty first install gets one setup action without an invented goal',async()=>{
 const {store,query}=fixture([]);
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-zero-goal'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Tell Godspeed one goal to work on today/);
 assert.doesNotMatch(content,/saved goal|current goal/i);
});

test('an empty first install still gets a setup action when the product name is banned',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Godspeed']);
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-zero-goal-no-name'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Name one goal today\./);assert.doesNotMatch(content,/Godspeed|saved goal/i);
});

test('several saved goals are not presented as one selected current goal',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Fictional first goal',status:'adopted'});store.save('goals',{title:'Fictional second goal',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-many-goals'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/One of your saved goals is/);assert.doesNotMatch(content,/Your current goal/);
});

test('fallback names verified user work and the next future obligation only',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('work_items',{kind:'draft',title:'Checked fictional outline',state:'verified'});
 store.save('work_items',{kind:'draft',title:'Private unapproved memo',state:'awaiting_approval'});
 store.save('work_items',{kind:'repair',title:'Recheck internal connector',state:'verified'});
 store.save('deadlines',{title:'Old fictional bill',status:'open',due_at:'2026-02-01T00:00:00Z'});
 store.save('deadlines',{title:'Submit fictional application',status:'open',due_at:'2027-01-01T00:00:00Z'});
 store.save('deadlines',{title:'Plan fictional travel',status:'open',due_at:'2027-02-01T00:00:00Z'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-work-date'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Checked fictional outline/);assert.match(content,/Submit fictional application, due 2027-01-01/);
 assert.doesNotMatch(content,/Private unapproved|Recheck internal|Old fictional bill|Plan fictional travel/);
});

test('fallback names an obligation by the installation day, not the UTC day',async()=>{
 const {store,query}=fixture([]);store.save('settings',{id:'installation',timezone:'America/Los_Angeles'});
 store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('deadlines',{title:'Pay the fictional rent',status:'open',due_at:'2027-11-08T04:00:00.000Z'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-local-day'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Pay the fictional rent, due 2027-11-07\./);
});

test('fallback chooses the latest verified work and fresh health by their recorded times',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('work_items',{kind:'draft',title:'Newer fictional approval',state:'verified',verification:{at:'2026-11-06T12:00:00Z'}});
 store.save('work_items',{kind:'draft',title:'Older fictional outline',state:'verified',verification:{at:'2026-11-05T12:00:00Z'}});
 const now=Date.now();store.save('health_observations',{metric:'Fictional energy',value:7,observed_at:new Date(now).toISOString()});
 store.save('health_observations',{metric:'Fictional headache',value:2,observed_at:new Date(now-86400000).toISOString()});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-time-order'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Newer fictional approval/);assert.doesNotMatch(content,/Older fictional outline/);
 assert.match(content,/Fictional energy: 7/);assert.doesNotMatch(content,/Fictional headache/);
});

test('fallback skips an unrenderable latest health value for a checked fresh observation',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const now=Date.now();store.save('health_observations',{metric:'Fictional energy',value:7,observed_at:new Date(now-1000).toISOString()});
 store.save('health_observations',{metric:'Fictional headache',value:'Moderate in the fictional afternoon, then improving',observed_at:new Date(now).toISOString()});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-usable-health'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Fictional energy: 7/);assert.doesNotMatch(content,/Fictional headache/);
});

test('fallback omits snoozed and not-yet-started obligations',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('deadlines',{title:'Fictional snoozed filing',status:'open',due_at:'2027-01-01T00:00:00Z',snoozed_until:'2027-01-01T00:00:00Z'});
 store.save('deadlines',{title:'Fictional future project',status:'open',start_at:'2027-01-01T00:00:00Z',due_at:'2027-02-01T00:00:00Z'});
 store.save('deadlines',{title:'Fictional current task',status:'open',due_at:'2027-03-01T00:00:00Z'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-obligation-window'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Fictional current task/);assert.doesNotMatch(content,/Fictional snoozed filing|Fictional future project/);
});

test('an unrenderable health value is omitted without claiming no observation exists',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('health_observations',{metric:'Fictional headache',value:{description:'Mild and improving'},observed_at:new Date().toISOString()});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-complex-health'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/no fresh health observations|\[object Object\]/i);assert.match(content,/goal step|concrete result/);
});

test('an impossible checked fallback retains the rejected draft and reasons for repair',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 1']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'Missing actionable next step'):'Unsupported private draft.';
 await assert.rejects(run(provider,query,store,'brief-impossible-fallback'),/Could not make a checked factual fallback/);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.equal(receipt.state,'failed');assert.equal(receipt.rejected_draft,'Unsupported private draft.');
 assert.ok(receipt.reasons.includes('Missing actionable next step'));assert.match(receipt.fallback_error,/checked factual fallback/);
 assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);
});

test('a rejected draft keeps a separately checked contribution and its exact link',async()=>{
 const {store,query}=fixture([]),content='Fictional copy ready draft.';
 const note=store.save('notes',{title:'Fictional contribution',content});store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-contribution-fallback'),saved=store.get('notes',result.record_id);
 assert.equal(result.fallback,true);assert.match(saved.content,/Fictional copy ready draft/);assert.match(saved.content,new RegExp('/dashboard/notes/'+note.id));
 assert.match(saved.content,/Review this checked draft before deciding\. It has not been sent\./);
});

test('a refused required line stays left out of the factual fallback',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Challenge'],{charm:true});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-required-line-fallback'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/Challenge/);
 assert.ok(repairs(query).some(w=>w.line_name==='the Charm Challenge line'));
});

test('a live Charm line survives a rejected draft in the factual fallback',async()=>{
 const {store,query}=fixture([],{charm:true});let line=null;
 const provider=async input=>{if(input.kind==='brief-verification')return readerFails(input,'No useful action');line=input.context.charm_line;return 'Unsupported draft.';};
 const result=await run(provider,query,store,'brief-live-charm'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.ok(line);assert.ok(content.split(/\r?\n/).includes(line));
});

test('a checked contribution survives a length restricted factual fallback',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 8']),content='Fictional checked draft.';
 const note=store.save('notes',{title:'Fictional contribution',content});store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-short-contribution'),saved=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(saved,/Fictional checked draft/);assert.match(saved,new RegExp('/dashboard/notes/'+note.id));
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

test('the existing cut fallback is not sent when its explanation breaks a voice rule',async()=>{
 const {store,query}=fixture(['BANNED-WORD: realm','BANNED-WORD: briefing']);
 const provider=async input=>verifies(input)||'The realm is here.';
 await assert.rejects(run(provider,query,store,'brief-old-cut-voice'),/Final exact briefing check failed: .*briefing/);
 assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);
 assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,0);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-cut');assert.equal(receipt.state,'failed');
 assert.ok(receipt.fallback_errors.some(e=>/voice check failed: briefing/.test(e)));
 const items=repairs(query);assert.equal(items.length,1);assert.equal(items[0].state,'needs_review');
});

test('the factual fallback names only visible facts, never hidden or sensitive ones',async()=>{
 const {store,query}=fixture([]);const now=Date.now();
 store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('goals',{title:'Fictional hidden goal',status:'adopted',ai_visibility:'hidden'});
 store.save('health_observations',{metric:'Fictional visible energy',value:6,observed_at:new Date(now-60000).toISOString()});
 store.save('health_observations',{metric:'Fictional hidden mood',value:3,observed_at:new Date(now-1000).toISOString(),ai_visibility:'hidden'});
 store.save('health_observations',{metric:'Fictional sensitive symptom',value:4,observed_at:new Date(now).toISOString(),is_sensitive:true});
 store.save('work_items',{kind:'draft',title:'Fictional hidden work',state:'verified',ai_visibility:'hidden',verification:{at:new Date(now).toISOString()}});
 store.save('deadlines',{title:'Fictional sensitive filing',status:'open',due_at:'2027-01-01T00:00:00Z',is_sensitive:true});
 const provider=async input=>input.kind==='brief-verification'?readerFails(input,'No useful action'):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-visible-only'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);
 assert.match(content,/Prepare a fictional guide/);assert.match(content,/Fictional visible energy: 6/);
 assert.doesNotMatch(content,/hidden|sensitive/i);
});

test('a repeated checked draft does not create a second briefing',async()=>{
 const {store,query}=fixture([]),provider=async input=>verifies(input)||OK;
 await run(provider,query,store,'brief-first');
 await assert.rejects(run(provider,query,store,'brief-repeat'),/already saved today/);
 assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,1);
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

// Archon R1: a claim the fact check rejected never comes back in the factual fallback, for every
// kind of source the fallback can name (goal, verified work, dated obligation, health value).
for(const [kind,save,claim,reason] of [
 ['goal',store=>store.save('goals',{title:'Prepare a fictional guide',status:'adopted'}),/fictional guide/i,'Prepare a fictional guide is unsupported'],
 ['verified work',store=>store.save('work_items',{kind:'draft',title:'Checked fictional outline',state:'verified'}),/fictional outline/i,'The claim that the checked fictional outline was verified is unsupported'],
 ['obligation',store=>store.save('deadlines',{title:'Submit fictional application',status:'open',due_at:'2027-01-01T00:00:00Z'}),/fictional application/i,'Submit fictional application is not a current obligation'],
 ['health value',store=>store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()}),/Fictional energy/i,'Fictional energy: 6 is stale'],
])test('the '+kind+' the fact check rejected is not repeated by the factual fallback',async()=>{
 const {store,query}=fixture([]),row=save(store);
 const provider=async input=>input.kind==='brief-verification'?sourceRejects(input,reason,[row.id]):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-'+kind.replaceAll(' ','-')),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,claim);assert.match(content,/goal/i);
 assert.ok(query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback').reasons.includes(reason));
});

test('a rejected goal is left out while another saved goal still gives the action',async()=>{
 const {store,query}=fixture([]);const rejected=store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});store.save('goals',{title:'Plant the fictional garden',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?sourceRejects(input,'Prepare a fictional guide is unsupported',[rejected.id]):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-one-goal'),content=store.get('notes',result.record_id).content;
 assert.doesNotMatch(content,/fictional guide/i);assert.match(content,/Ask Godspeed to work on Plant the fictional garden/);
});

// A source rejection is retained across both attempts, so a first-attempt rejection still holds
// when the rewrite fails for a different reason.
for(const [kind,save,claim] of [
 ['goal',store=>store.save('goals',{title:'Prepare a fictional guide',status:'adopted'}),/fictional guide/i],
 ['verified work',store=>store.save('work_items',{kind:'draft',title:'Checked fictional outline',state:'verified'}),/fictional outline/i],
 ['obligation',store=>store.save('deadlines',{title:'Submit fictional application',status:'open',due_at:'2027-01-01T00:00:00Z'}),/fictional application/i],
 ['health value',store=>store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()}),/Fictional energy/i],
])test('the '+kind+' rejected by id in the first attempt stays out when the rewrite fails for another reason',async()=>{
 const {store,query}=fixture([]);const row=save(store);assert.ok(row?.id);let checks=0;
 const provider=async input=>{if(input.kind!=='brief-verification')return 'Unsupported draft.';checks++;
  return checks<=2?(input.check==='source-facts'?{passed:false,reason:'One claim in the draft is unsupported',rejection_scope:'source-claims',rejected_source_ids:[row.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}):(input.check==='source-facts'?{passed:true,reason:'Fictional facts checked.'}:{passed:false,reason:'The rewrite is too vague',rejection_scope:'non-source',rejected_source_ids:[]});};
 const result=await run(provider,query,store,'brief-first-attempt-'+kind.replaceAll(' ','-')),content=store.get('notes',result.record_id).content;
 assert.equal(checks,4);assert.equal(result.fallback,true);assert.doesNotMatch(content,claim);assert.match(content,/goal/i);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.deepEqual(receipt.rejected_source_ids,[String(row.id)]);assert.ok(receipt.all_reasons.includes('One claim in the draft is unsupported'));
});

test('a first-attempt source rejection holds after a differently rejected rewrite',async()=>{
 const {store,query}=fixture([]);const goal=store.save('goals',{title:'Prepare release notes.',status:'adopted'});let checks=0;
 const provider=async input=>{if(input.kind!=='brief-verification')return 'Unsupported draft.';checks++;
  return checks<=2?(input.check==='source-facts'?{passed:false,reason:'Prepare release notes is unsupported',rejection_scope:'source-claims',rejected_source_ids:[goal.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}):(input.check==='source-facts'?{passed:true,reason:'Fictional facts checked.'}:{passed:false,reason:'The rewrite is too vague',rejection_scope:'non-source',rejected_source_ids:[]});};
 const result=await run(provider,query,store,'brief-first-attempt-reason'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/release notes/i);
});

// A malformed source-claim review leaves no safe inventory for the fallback. It is refused, and the
// rejected draft and reasons remain in the failed receipt.
for(const [name,verdict] of [
 ['an empty id list',{passed:false,reason:'The only saved goal is no longer an active commitment.',rejection_scope:'source-claims',rejected_source_ids:[]}],
 ['no id list',{passed:false,reason:'The only saved goal is no longer an active commitment.',rejection_scope:'source-claims'}],
 ['an id list that is not a list',{passed:false,reason:'The only saved goal is no longer an active commitment.',rejection_scope:'source-claims',rejected_source_ids:'the goal'}],
 ['an id that is not one of its sources',{passed:false,reason:'The only saved goal is no longer an active commitment.',rejection_scope:'source-claims',rejected_source_ids:['fictional-unknown-id']}],
])test('a failed fact check with '+name+' sends no fallback and keeps the evidence',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Cancel the fictional contract',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?(input.check==='source-facts'?verdict:{passed:false,reason:'Unclear',rejection_scope:'non-source',rejected_source_ids:[]}):'Unsupported private draft.';
 await assert.rejects(run(provider,query,store,'brief-unidentified-'+name.replaceAll(' ','-')),/Could not make a checked factual fallback/);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.equal(receipt.state,'failed');assert.equal(receipt.rejected_draft,'Unsupported private draft.');assert.ok(receipt.reasons.includes(verdict.reason));
 assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);assert.equal(query.rows('notifications').length,0);
});

// Archon R2, round 3: a contribution the review rejected by id is neither repeated nor required; the
// fallback takes the ordinary goal action and the contribution stays ready, never marked as shown.
for(const which of ['lead entry','backing note'])test('a contribution rejected by its '+which+' id stays out of the factual fallback',async()=>{
 const {store,query}=fixture([]),content='Unverified fictional contribution.';store.save('goals',{title:'Plant the fictional garden',status:'adopted'});
 const note=store.save('notes',{title:'Fictional contribution',content}),entry=store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const id=which==='lead entry'?entry.id:note.id;
 const provider=async input=>input.kind==='brief-verification'?(input.check==='source-facts'?{passed:false,reason:'One claim is unsupported',rejection_scope:'source-claims',rejected_source_ids:[id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-contribution-'+which.replaceAll(' ','-')),saved=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(saved,/Unverified fictional contribution/);assert.doesNotMatch(saved,new RegExp('/dashboard/notes/'+note.id));
 assert.doesNotMatch(saved,/Review this/);assert.match(saved,/Ask Godspeed to work on Plant the fictional garden/);
 assert.equal(store.get('lead_entries',entry.id).status,'ready');
});

// Archon R1, PR #270: an unfinished phone total is rendered by code as a "so far" line plus a weekly
// count of unknown days. When a review rejects that phone record by id, the line and its share of the
// weekly count stay out of the factual fallback; another day's unrejected phone total still counts.
// Health freshness runs on the real clock, so the days are recent real days.
const daysAgo=n=>new Date(Date.now()-n*86400000).toISOString().slice(0,10);
test('a phone total rejected by id leaves its so-far line and its weekly count out of the factual fallback',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Plant the fictional garden',status:'adopted'});
 const phone=(day,value,until)=>store.save('health_observations',{metric:'steps',value,source:'Health Auto Export',via:'phone-receiver',observed_on:day,date_precision:'day',observed_at:day+'T00:00:00Z',data_until:until});
 const bad=phone(daysAgo(2),4200,'08:00:00');phone(daysAgo(3),3100,'09:30:00');
 const provider=async input=>input.kind==='brief-verification'?(input.check==='source-facts'?{passed:false,reason:'One claim is unsupported',rejection_scope:'source-claims',rejected_source_ids:[bad.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-phone-total'),saved=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);
 assert.doesNotMatch(saved,/4200/);assert.doesNotMatch(saved,/08:00:00/);assert.doesNotMatch(saved,/2 unknown phone-health days/);
 assert.ok(saved.includes('On '+daysAgo(3)+', steps was 3100 so far; phone data stopped at 09:30:00.'));
 assert.match(saved,/This week has 1 unknown phone-health day\./);assert.match(saved,/Ask Godspeed to work on Plant the fictional garden/);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');assert.deepEqual(receipt.rejected_source_ids,[String(bad.id)]);
});

test('a rejected later phone metric removes another metric that supplied its day stopped time',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Plant the fictional garden',status:'adopted'});
 const phone=(metric,value,until)=>store.save('health_observations',{metric,value,source:'Health Auto Export',via:'phone-receiver',observed_on:daysAgo(2),date_precision:'day',observed_at:daysAgo(2)+'T00:00:00Z',data_until:until});
 phone('steps',4200,'08:00:00');const rejected=phone('weight_kg',70,'09:30:00');
 const provider=async input=>input.kind==='brief-verification'?(input.check==='source-facts'?{passed:false,reason:'One claim is unsupported',rejection_scope:'source-claims',rejected_source_ids:[rejected.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-cross-metric-phone-total'),saved=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(saved,/4200|70|09:30:00|unknown phone-health/);assert.match(saved,/Ask Godspeed to work on Plant the fictional garden/);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');assert.deepEqual(receipt.rejected_source_ids,[String(rejected.id)]);
});

test('when every phone total is rejected by id, the factual fallback carries no so-far line and no weekly count',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Plant the fictional garden',status:'adopted'});
 const bad=store.save('health_observations',{metric:'steps',value:4200,source:'Health Auto Export',via:'phone-receiver',observed_on:daysAgo(2),date_precision:'day',observed_at:daysAgo(2)+'T00:00:00Z',data_until:'08:00:00'});
 const provider=async input=>input.kind==='brief-verification'?(input.check==='source-facts'?{passed:false,reason:'One claim is unsupported',rejection_scope:'source-claims',rejected_source_ids:[bad.id]}:{passed:false,reason:'The draft is not useful enough.',rejection_scope:'non-source',rejected_source_ids:[]}):'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-only-phone-total'),saved=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(saved,/4200|so far|unknown phone-health/);assert.match(saved,/Ask Godspeed to work on Plant the fictional garden/);
});
