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

test('a five-word sentence limit still yields an action with a saved goal',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 5']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-five-word-action'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Do one goal step\./);
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

test('an empty first install gets one setup action without an invented goal',async()=>{
 const {store,query}=fixture([]);
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-zero-goal'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Tell Godspeed one goal to work on today/);
 assert.doesNotMatch(content,/saved goal|current goal/i);
});

test('an empty first install still gets a setup action when the product name is banned',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Godspeed']);
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-zero-goal-no-name'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.match(content,/Name one goal today\./);assert.doesNotMatch(content,/Godspeed|saved goal/i);
});

test('several saved goals are not presented as one selected current goal',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Fictional first goal',status:'adopted'});store.save('goals',{title:'Fictional second goal',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
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
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-work-date'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Checked fictional outline/);assert.match(content,/Submit fictional application, due 2027-01-01/);
 assert.doesNotMatch(content,/Private unapproved|Recheck internal|Old fictional bill|Plan fictional travel/);
});

test('fallback names an obligation by the installation day, not the UTC day',async()=>{
 const {store,query}=fixture([]);store.save('settings',{id:'installation',timezone:'America/Los_Angeles'});
 store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('deadlines',{title:'Pay the fictional rent',status:'open',due_at:'2027-11-08T04:00:00.000Z'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-local-day'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Pay the fictional rent, due 2027-11-07\./);
});

test('fallback chooses the latest verified work and fresh health by their recorded times',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('work_items',{kind:'draft',title:'Newer fictional approval',state:'verified',verification:{at:'2026-11-06T12:00:00Z'}});
 store.save('work_items',{kind:'draft',title:'Older fictional outline',state:'verified',verification:{at:'2026-11-05T12:00:00Z'}});
 const now=Date.now();store.save('health_observations',{metric:'Fictional energy',value:7,observed_at:new Date(now).toISOString()});
 store.save('health_observations',{metric:'Fictional headache',value:2,observed_at:new Date(now-86400000).toISOString()});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-time-order'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Newer fictional approval/);assert.doesNotMatch(content,/Older fictional outline/);
 assert.match(content,/Fictional energy: 7/);assert.doesNotMatch(content,/Fictional headache/);
});

test('fallback skips an unrenderable latest health value for a checked fresh observation',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const now=Date.now();store.save('health_observations',{metric:'Fictional energy',value:7,observed_at:new Date(now-1000).toISOString()});
 store.save('health_observations',{metric:'Fictional headache',value:'Moderate in the fictional afternoon, then improving',observed_at:new Date(now).toISOString()});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-usable-health'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Fictional energy: 7/);assert.doesNotMatch(content,/Fictional headache/);
});

test('fallback omits snoozed and not-yet-started obligations',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('deadlines',{title:'Fictional snoozed filing',status:'open',due_at:'2027-01-01T00:00:00Z',snoozed_until:'2027-01-01T00:00:00Z'});
 store.save('deadlines',{title:'Fictional future project',status:'open',start_at:'2027-01-01T00:00:00Z',due_at:'2027-02-01T00:00:00Z'});
 store.save('deadlines',{title:'Fictional current task',status:'open',due_at:'2027-03-01T00:00:00Z'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-obligation-window'),content=store.get('notes',result.record_id).content;
 assert.match(content,/Fictional current task/);assert.doesNotMatch(content,/Fictional snoozed filing|Fictional future project/);
});

test('an unrenderable health value is omitted without claiming no observation exists',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 store.save('health_observations',{metric:'Fictional headache',value:{description:'Mild and improving'},observed_at:new Date().toISOString()});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-complex-health'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/no fresh health observations|\[object Object\]/i);assert.match(content,/goal step|concrete result/);
});

test('an impossible checked fallback retains the rejected draft and reasons for repair',async()=>{
 const {store,query}=fixture(['MAX-SENTENCE-WORDS: 1']);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'Missing actionable next step'}:'Unsupported private draft.';
 await assert.rejects(run(provider,query,store,'brief-impossible-fallback'),/Could not make a checked factual fallback/);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.equal(receipt.state,'failed');assert.equal(receipt.rejected_draft,'Unsupported private draft.');
 assert.ok(receipt.reasons.includes('Missing actionable next step'));assert.match(receipt.fallback_error,/checked factual fallback/);
 assert.equal(query.rows('notes').filter(n=>n.source_app==='morning-brief').length,0);
});

test('a rejected draft keeps a separately checked contribution and its exact link',async()=>{
 const {store,query}=fixture([]),content='Fictional copy ready draft.';
 const note=store.save('notes',{title:'Fictional contribution',content});store.save('lead_entries',{title:note.title,content,note_id:note.id,status:'ready',delivery_day:'2026-01-01'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-contribution-fallback'),saved=store.get('notes',result.record_id);
 assert.equal(result.fallback,true);assert.match(saved.content,/Fictional copy ready draft/);assert.match(saved.content,new RegExp('/dashboard/notes/'+note.id));
 assert.match(saved.content,/Review this checked draft before deciding\. It has not been sent\./);
});

test('a refused required line stays left out of the factual fallback',async()=>{
 const {store,query}=fixture(['BANNED-WORD: Challenge'],{charm:true});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-required-line-fallback'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/Challenge/);
 assert.ok(repairs(query).some(w=>w.line_name==='the Charm Challenge line'));
});

test('a live Charm line survives a rejected draft in the factual fallback',async()=>{
 const {store,query}=fixture([],{charm:true});let line=null;
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:false,reason:'No useful action'};line=input.context.charm_line;return 'Unsupported draft.';};
 const result=await run(provider,query,store,'brief-live-charm'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.ok(line);assert.ok(content.split(/\r?\n/).includes(line));
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
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'No useful action'}:'Unsupported draft.';
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
 const {store,query}=fixture([]);save(store);
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-'+kind.replaceAll(' ','-')),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,claim);assert.match(content,/goal/i);
 assert.ok(query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback').reasons.includes(reason));
});

test('a rejected goal is left out while another saved goal still gives the action',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});store.save('goals',{title:'Plant the fictional garden',status:'adopted'});
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason:'Prepare a fictional guide is unsupported'}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-rejected-one-goal'),content=store.get('notes',result.record_id).content;
 assert.doesNotMatch(content,/fictional guide/i);assert.match(content,/Ask Godspeed to work on Plant the fictional garden/);
});

// Archon R1, round 2: a source the review rejects is excluded by its id, gathered from both attempts,
// so a first-attempt rejection still holds when the rewrite fails for a different reason, and a
// source whose title ends in punctuation is still matched by the reason that names it.
for(const [kind,save,claim] of [
 ['goal',store=>store.save('goals',{title:'Prepare a fictional guide',status:'adopted'}),/fictional guide/i],
 ['verified work',store=>store.save('work_items',{kind:'draft',title:'Checked fictional outline',state:'verified'}),/fictional outline/i],
 ['obligation',store=>store.save('deadlines',{title:'Submit fictional application',status:'open',due_at:'2027-01-01T00:00:00Z'}),/fictional application/i],
 ['health value',store=>store.save('health_observations',{metric:'Fictional energy',value:6,observed_at:new Date().toISOString()}),/Fictional energy/i],
])test('the '+kind+' rejected by id in the first attempt stays out when the rewrite fails for another reason',async()=>{
 const {store,query}=fixture([]);const row=save(store);assert.ok(row?.id);let checks=0;
 const provider=async input=>{if(input.kind!=='brief-verification')return 'Unsupported draft.';checks++;
  return checks<=2?{passed:false,reason:'One claim in the draft is unsupported',rejected_source_ids:input.check==='source-facts'?[row.id]:[]}:{passed:false,reason:'The rewrite is too vague'};};
 const result=await run(provider,query,store,'brief-first-attempt-'+kind.replaceAll(' ','-')),content=store.get('notes',result.record_id).content;
 assert.equal(checks,4);assert.equal(result.fallback,true);assert.doesNotMatch(content,claim);assert.match(content,/goal/i);
 const receipt=query.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.deepEqual(receipt.rejected_source_ids,[String(row.id)]);assert.ok(receipt.all_reasons.includes('One claim in the draft is unsupported'));
});

test('a first-attempt reason naming a source still holds after a differently rejected rewrite',async()=>{
 const {store,query}=fixture([]);store.save('goals',{title:'Prepare release notes.',status:'adopted'});let checks=0;
 const provider=async input=>{if(input.kind!=='brief-verification')return 'Unsupported draft.';checks++;
  return checks<=2?{passed:false,reason:'Prepare release notes is unsupported'}:{passed:false,reason:'The rewrite is too vague'};};
 const result=await run(provider,query,store,'brief-first-attempt-reason'),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,/release notes/i);
});

for(const [kind,save,claim,reason] of [
 ['goal',store=>store.save('goals',{title:'Prepare release notes.',status:'adopted'}),/release notes/i,'Prepare release notes is unsupported'],
 ['verified work',store=>store.save('work_items',{kind:'draft',title:'Checked fictional outline.',state:'verified'}),/fictional outline/i,'Checked fictional outline is unsupported'],
 ['obligation',store=>store.save('deadlines',{title:'Submit fictional application.',status:'open',due_at:'2027-01-01T00:00:00Z'}),/fictional application/i,'Submit fictional application is not current'],
 ['health value',store=>store.save('health_observations',{metric:'Fictional energy.',value:6,observed_at:new Date().toISOString()}),/Fictional energy/i,'Fictional energy 6 is stale'],
])test('the '+kind+' whose title ends in punctuation is still excluded by the reason that names it',async()=>{
 const {store,query}=fixture([]);save(store);
 const provider=async input=>input.kind==='brief-verification'?{passed:false,reason}:'Unsupported draft.';
 const result=await run(provider,query,store,'brief-punctuated-'+kind.replaceAll(' ','-')),content=store.get('notes',result.record_id).content;
 assert.equal(result.fallback,true);assert.doesNotMatch(content,claim);
});
