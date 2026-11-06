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
test.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_NOW;});

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
 const provider=async input=>input.kind==='brief-verification'?{passed:input.check==='source-facts'&&reason==='No useful next action',reason}:++writes&&'Private unsupported claim: the guide sold 100 copies.';
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
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-voice-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Ask Godspeed to complete one goal step/);assert.doesNotMatch(content,/guide/i);
});

test('a short sentence limit still yields a concrete action',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 8']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-short-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Ask Godspeed to complete one goal step/);
});

test('a voice rule against the product name still leaves a goal action',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Godspeed']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-no-name-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Work on one goal step today/);assert.doesNotMatch(content,/Godspeed/);
});

test('a long saved goal is not mistaken for missing setup',async()=>{
 const {store,query}=fixture([]),title='Prepare the fictional field guide to coastal lighthouses and ship it to every subscriber before the fictional winter season begins';
 store.save('goals',{title,status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-long-goal'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Prepare the fictional field guide/);assert.doesNotMatch(content,/Tell Godspeed one goal/);
});

test('fallback names verified user work and the next future obligation only',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('work_items',{kind:'draft',title:'Checked fictional outline',state:'verified'});
 store.save('work_items',{kind:'draft',title:'Private unapproved memo',state:'awaiting_approval'});
 store.save('work_items',{kind:'repair',title:'Recheck internal connector',state:'verified'});
 store.save('deadlines',{title:'Old fictional bill',status:'open',due_at:'2026-02-01T00:00:00Z'});
 store.save('deadlines',{title:'Submit fictional application',status:'open',due_at:'2027-01-01T00:00:00Z'});
 store.save('deadlines',{title:'Plan fictional travel',status:'open',due_at:'2027-02-01T00:00:00Z'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-work-date'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Checked fictional outline/);assert.match(content,/Submit fictional application, due 2027-01-01/);
 assert.doesNotMatch(content,/Private unapproved|Recheck internal|Old fictional bill|Plan fictional travel/);
});

test('a rejected draft keeps a separately checked contribution and its exact link',async()=>{
 const {store,query}=fixture([]),content='Fictional copy ready draft.';
 const note=store.save('notes',{title:'Fictional contribution',content});store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-contribution-fallback'),saved=store.get('notes',result.record_id);
 assert.equal(result.fallback,true);assert.match(saved.content,/Fictional copy ready draft/);assert.match(saved.content,new RegExp('/dashboard/notes/'+note.id));
});

test('a refused required line stays left out of the factual fallback',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Challenge'],{charm:true});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-required-line-fallback'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/Challenge/);
 assert.ok(repairs(query).some(w=>w.line_name==='the Charm Challenge line'));
});

test('a checked contribution survives a length restricted factual fallback',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 8']),content='Fictional checked draft.';
 const note=store.save('notes',{title:'Fictional contribution',content});store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
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

test('the existing cut fallback still saves when its explanation breaks a voice rule',async()=>{
 const {store,query}=fixture(['BANNED-WORD: realm','BANNED-WORD: briefing']);
 const provider=async input=>verifies(input)||'The realm is here.';
 const result=await run(provider,query,store,'brief-old-cut-voice');
 assert.equal(result.fallback,true);assert.ok(store.get('notes',result.record_id));
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
