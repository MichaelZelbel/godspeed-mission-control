import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {briefing} from '../core/briefing.mjs';
import {newsWindow,classify,thinCheck,MAX_GAP_DAYS} from '../core/briefing-news.mjs';import {draftItems,applyFindings} from '../core/briefing-cut.mjs';
// Issue #387: on 10 November 2026 the brief went out at 153 words. Repair cut both numbered items
// over a wording nit each, week-old news counted as new without its date, a partly read pool was
// never widened, and the thin result passed every check.
const NOW=new Date('2026-11-10T06:00:00Z'),FUTURE='2099-01-01T00:00:00Z';
const HEALTH='No fresh fictional health observations are available.';
const workspace=name=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-'+name+'-')));return {store,query:new QueryService(store)};};
const pass={passed:true,reason:'Fictional check passed.',rejection_scope:'non-source',rejected_source_ids:[]};
const fail=(findings)=>({passed:false,reason:'A fictional sentence reads wrong.',rejection_scope:'non-source',rejected_source_ids:[],findings});
const run=async(store,query,{write,check=()=>pass,repair=()=>({sentence:''}),now=NOW,job='brief-387'})=>{
 const calls=[];
 const provider=async input=>{
  calls.push(input);
  if(input.kind==='brief-verification')return check(input);
  if(input.kind==='brief-sentence-repair')return repair(input);
  return write(input);
 };
 const result=await briefing({kind:'morning-brief',id:job},{store,query,provider,now});
 const note=result.record_id?store.get('notes',result.record_id):null;
 return {result,note,calls,writes:calls.filter(c=>c.kind==='morning-brief'),receipt:kind=>store.list('job_receipts').filter(r=>r.kind===kind).at(-1)};
};

// The 10 November shape: two news paragraphs and two numbered items, each with one wording nit.
const ITEM_ONE='1. Your 10:00 call clashes with the fictional dentist visit. He waits for you to pick one.';
const ITEM_TWO='2. The fictional sales pause needs your decision by Friday. She waits for you to say yes.';
const TENTH=['Your Tuesday starts with two fictional appointments. '+HEALTH,'A fictional library shipped version 2. https://fictional.invalid/news-one','A fictional standards body opened a review. https://fictional.invalid/news-two',ITEM_ONE+'\n'+ITEM_TWO].join('\n\n');
const nits=draft=>[
 ...(draft.includes('He waits for you to pick one.')?[{sentence:'He waits for you to pick one.',problem:'wording',reason:'Nobody is waiting.'}]:[]),
 ...(draft.includes('She waits for you to say yes.')?[{sentence:'She waits for you to say yes.',problem:'wording',reason:'The sources name no person.'}]:[]),
];
const readerNits=input=>{if(input.check==='source-facts')return pass;const found=nits(input.context.draft);return found.length?fail(found):pass;};

test('the 10 November brief keeps both numbered items: repair rewrites only the flagged sentences',async()=>{
 const {store,query}=workspace('keeps-items');
 const {result,note,receipt,calls}=await run(store,query,{write:()=>TENTH,check:readerNits,repair:input=>({sentence:/dentist/.test(input.context.item)?'Pick one of the two.':'Say whether the pause goes ahead.'})});
 assert.equal(result.fallback,undefined);
 assert.match(note.content,/^1\. Your 10:00 call clashes with the fictional dentist visit\. Pick one of the two\.$/m);
 assert.match(note.content,/^2\. The fictional sales pause needs your decision by Friday\. Say whether the pause goes ahead\.$/m);
 const repair=receipt('brief-repair');
 assert.equal(repair.state,'verified');
 assert.deepEqual(repair.changes.map(c=>c.action),['rewrite','rewrite']);
 assert.equal(calls.filter(c=>c.kind==='brief-sentence-repair').length,2);
 assert.match(calls.find(c=>c.phase==='one-rewrite').context.check_feedback.join('\n'),/Flagged sentence "He waits for you to pick one\." \(wording\)/);
 assert.match(calls.find(c=>c.kind==='brief-verification').contract,/core-unsupported/);
});

test('only an item whose core fact is unsupported is cut, and the cut names its reason',async()=>{
 const {store,query}=workspace('cuts-unsupported');
 const check=input=>{if(input.check==='plain-words-and-delivery')return readerNits(input);const draft=input.context.draft;return draft.includes('sales pause')?fail([{sentence:'The fictional sales pause needs your decision by Friday.',problem:'core-unsupported',reason:'No source mentions a sales pause.'}]):pass;};
 const {note,receipt}=await run(store,query,{write:()=>TENTH,check,repair:()=>({sentence:'Pick one of the two.'})});
 assert.doesNotMatch(note.content,/sales pause/);
 assert.match(note.content,/^1\. Your 10:00 call clashes with the fictional dentist visit\. Pick one of the two\.$/m);
 const cut=receipt('brief-repair').changes.find(c=>c.action==='cut-item');
 assert.equal(cut.reason,'No source mentions a sales pause.');
 assert.match(cut.item,/^2\./);
});

test('a flagged sentence with no usable rewrite is dropped alone, never its item',async()=>{
 const {store,query}=workspace('drops-sentence');
 const {note,receipt}=await run(store,query,{write:()=>TENTH,check:readerNits,repair:input=>({sentence:/dentist/.test(input.context.item)?'':'Say whether the pause goes ahead.'})});
 assert.match(note.content,/^1\. Your 10:00 call clashes with the fictional dentist visit\.$/m);
 assert.match(note.content,/^2\. The fictional sales pause needs your decision by Friday\. Say whether the pause goes ahead\.$/m);
 assert.deepEqual(receipt('brief-repair').changes.map(c=>c.action),['drop-sentence','rewrite']);
});

test('a rewritten sentence the recheck still flags is dropped, and its item stays',async()=>{
 const {store,query}=workspace('recheck-drops');
 const check=input=>{if(input.check==='source-facts')return pass;const draft=input.context.draft,found=[...nits(draft),...(draft.includes('Pick one of the two.')?[{sentence:'Pick one of the two.',problem:'wording',reason:'Still too pushy.'}]:[])];return found.length?fail(found):pass;};
 const {result,note,receipt}=await run(store,query,{write:()=>TENTH,check,repair:input=>({sentence:/dentist/.test(input.context.item)?'Pick one of the two.':'Say whether the pause goes ahead.'})});
 assert.equal(result.fallback,undefined);
 assert.doesNotMatch(note.content,/Pick one of the two|He waits for you/);
 assert.match(note.content,/^1\. Your 10:00 call clashes with the fictional dentist visit\.$/m);
 assert.match(note.content,/^2\. The fictional sales pause needs your decision by Friday\. Say whether the pause goes ahead\.$/m);
 assert.equal(receipt('brief-repair').state,'dropped-after-recheck');
});

test('a recheck that fails without naming its sentences takes the factual fallback',async()=>{
 const {store,query}=workspace('recheck-unnamed');
 const check=input=>{if(input.check==='source-facts')return pass;const draft=input.context.draft;return draft.includes('Pick one of the two.')?fail(undefined):nits(draft).length?fail(nits(draft)):pass;};
 const {result,note,receipt}=await run(store,query,{write:()=>TENTH,check,repair:input=>({sentence:/dentist/.test(input.context.item)?'Pick one of the two.':'Say whether the pause goes ahead.'})});
 assert.equal(result.fallback,true);
 assert.doesNotMatch(note.content,/Pick one of the two/);
 assert.equal(receipt('brief-repair').state,'failed');
 assert.equal(receipt('brief-repair').error,'The recheck failed without naming its sentences');
});

const earlierBrief=(store,day,at)=>store.save('notes',{title:'Your morning briefing',content:'An earlier fictional brief of '+day+'.',source_app:'morning-brief',brief_day:day,created_at:at});
test('news reaches back two days, and one day further for each missed morning',async()=>{
 for(const [day,start,gap] of [['2026-11-09','2026-11-08',0],['2026-11-06','2026-11-05',3]]){
  const {store,query}=workspace('window');earlierBrief(store,day,day+'T06:00:00Z');
  const {note}=await run(store,query,{write:()=>HEALTH});
  assert.equal(note.evidence.news_pool.search_start,start);
  assert.equal(note.evidence.news_pool.recovery_gap_days,gap);
 }
});

test('an older post found since the last brief says its date; one an earlier brief could tell is left out',async()=>{
 const {store,query}=workspace('older-news');earlierBrief(store,'2026-11-09','2026-11-09T06:00:00Z');
 const topic=store.save('watch_topics',{title:'Fictional release notes',paused:true}),link='https://fictional.invalid/release-post';
 const observation=store.save('watch_observations',{topic_id:topic.id,url:link,status:200,content:'Fictional release post.',observed_at:'2026-11-09T20:00:00Z',changed:true,comparison:{meaningful:true,evidence:'Fictional release post.',follow_up:'Read it',published:'2026-11-05'}});
 store.save('watch_findings',{topic_id:topic.id,score:60,what:'A fictional release post explains version 3.',link,status:'pending',expires:FUTURE,source_observation_id:observation.id,created_at:'2026-11-09T20:00:00Z'});
 const stale=store.save('watch_findings',{topic_id:topic.id,score:90,what:'An old fictional item.',link:'https://fictional.invalid/old',status:'pending',expires:FUTURE,created_at:'2026-11-04T08:00:00Z'});
 const {note,writes}=await run(store,query,{write:()=>HEALTH+'\n\nA fictional release post explains version 3. '+link});
 const told=writes[0].context.watch_findings;
 assert.equal(told.length,1);assert.notEqual(told[0].id,stale.id);
 assert.equal(told[0].age_label,'from 5 November');
 assert.match(note.content.split('\n\n').find(block=>block.includes(link)),/from 5 November/);
 assert.match(writes[0].contract,/age_label/);
});

const serve=async t=>{
 const server=http.createServer((req,res)=>{if(req.url==='/broken'){res.statusCode=500;res.end('Fictional failure');}else res.end('Fictional wider source words.');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const saved=process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL;process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL='1';t.after(()=>{if(saved===undefined)delete process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL;else process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL=saved;});
 return 'http://127.0.0.1:'+server.address().port;
};
test('a partly read pool reads the owner\'s other watch topics before writing, and its record says so',async t=>{
 const base=await serve(t),{store,query}=workspace('widens');
 const brief=store.save('watch_topics',{title:'Fictional brief source',url:base+'/broken',include_in_brief:true});
 const other=store.save('watch_topics',{title:'Fictional other source',url:base+'/fine'});
 const {note,writes}=await run(store,query,{write:()=>HEALTH,now:new Date()});
 const pool=note.evidence.news_pool;
 assert.equal(pool.status,'partial');
 assert.deepEqual(pool.topics.find(p=>p.id===brief.id).problems,[{url:base+'/broken',reason:'could not be read'}]);
 assert.ok(pool.widened.reason.includes('partial'));
 assert.ok(pool.widened.topics_read.includes(other.id));
 assert.ok(writes[0].context.source_receipts.some(r=>r.url===base+'/fine'&&r.content==='Fictional wider source words.'));
});

test('a full pool of fresh news is not widened',async()=>{
 const {store,query}=workspace('full-pool');const now=new Date();
 for(const n of [1,2,3]){const topic=store.save('watch_topics',{title:'Fictional source '+n,url:'https://fictional.invalid/'+n,include_in_brief:true,next_run_at:FUTURE});store.save('watch_observations',{topic_id:topic.id,url:topic.url,status:200,content:'Fictional news '+n,observed_at:now.toISOString(),changed:true,comparison:{meaningful:true,evidence:'Fictional news '+n}});}
 const other=store.save('watch_topics',{title:'Fictional unread source',url:'https://fictional.invalid/other'});
 const {note}=await run(store,query,{write:()=>HEALTH+'\n\nFictional news 1. https://fictional.invalid/1\n\nFictional news 2. https://fictional.invalid/2',now});
 assert.equal(note.evidence.news_pool.status,'complete');
 assert.equal(note.evidence.news_pool.fresh,3);
 assert.equal(note.evidence.news_pool.widened,null);
 assert.equal(store.list('watch_runs').filter(r=>r.topic_id===other.id).length,0);
});

test('findings the writer does not get leave the pool thin, so it is widened',async()=>{
 const {store,query}=workspace('queued-findings');const now=new Date();
 const topic=store.save('watch_topics',{title:'Fictional feed',paused:true});
 for(const n of [1,2,3])store.save('watch_findings',{topic_id:topic.id,score:60+n,what:'Fictional story '+n+'.',link:'https://fictional.invalid/story-'+n,status:'pending',expires:FUTURE,created_at:now.toISOString()});
 const {note,writes}=await run(store,query,{write:()=>HEALTH,now});
 assert.equal(writes[0].context.watch_findings.length,1);
 assert.equal(note.evidence.news_pool.fresh,1);
 assert.deepEqual(note.evidence.news_pool.widened.reason,['thin']);
});

// The 153-word shape: an opening and one news item, while a prepared decision waited.
const thinFixture=name=>{
 const {store,query}=workspace(name),topic=store.save('watch_topics',{title:'Fictional feed',paused:true}),link='https://fictional.invalid/one-story';
 store.save('watch_findings',{topic_id:topic.id,score:60,what:'A fictional story.',link,status:'pending',expires:FUTURE});
 const draft=store.save('notes',{title:'Fictional supplier reply',content:'Fictional prepared reply to the supplier.'});
 store.save('work_items',{title:'Answer the fictional supplier',state:'awaiting_approval',draft_id:draft.id});
 return {store,query,link,artifact:'/dashboard/notes/'+encodeURIComponent(draft.id),thinText:'Your day is open. '+HEALTH+'\n\nA fictional story. '+link};
};
test('a thin brief goes back once to add the decision that was waiting',async()=>{
 const {store,query,link,artifact,thinText}=thinFixture('thin-repaired');
 const {result,note,writes,receipt}=await run(store,query,{now:new Date(),write:input=>input.phase==='thin-repair'?thinText+'\n\nRead the fictional supplier reply before you allow it: '+artifact:thinText});
 const repair=writes.find(w=>w.phase==='thin-repair');
 assert.ok(repair);assert.equal(repair.context.missing.action_artifacts[0].link,artifact);assert.equal(repair.context.thin_draft,thinText);
 assert.equal(result.thin,undefined);
 assert.ok(note.content.includes(artifact)&&note.content.includes(link));
 assert.equal(receipt('brief-final-check').state,'passed');
 assert.equal(receipt('brief-final-check').thin_repair,'passed');
});

test('a brief still thin after its repair says so and why',async()=>{
 const {store,query,thinText}=thinFixture('thin-told');
 const check=input=>input.check==='source-facts'&&/supplier/.test(input.context.draft)?{passed:false,reason:'Fictional unsupported claim.',rejection_scope:'non-source',rejected_source_ids:[]}:pass;
 const {result,note,receipt}=await run(store,query,{now:new Date(),check,write:input=>input.phase==='thin-repair'?thinText+'\n\nThe fictional supplier already agreed.':thinText});
 assert.equal(result.thin.reasons[0],'nothing waits for your decision');assert.match(result.thin.reasons[1],/^only 1 fresh news item came in since \d+ \w+$/);
 assert.equal(receipt('brief-final-check').state,'thin');
 assert.equal(receipt('brief-final-check').thin_repair,'failed');
 assert.match(note.content,/\n\nThis brief is thin today: nothing waits for your decision; only 1 fresh news item came in since \d+ \w+\.$/);
});

test('a thin repair whose model call fails leaves the checked brief to go out, told thin',async()=>{
 const {store,query,thinText}=thinFixture('thin-repair-throws');
 const {result,note,receipt}=await run(store,query,{now:new Date(),write:input=>{if(input.phase==='thin-repair')throw Error('Fictional provider outage');return thinText;}});
 assert.ok(note.content.startsWith(thinText));
 assert.ok(result.thin);
 assert.equal(receipt('brief-final-check').thin_repair,'failed');
 assert.match(note.content,/This brief is thin today: nothing waits for your decision/);
});

test('a quiet installation with nothing to tell is flagged thin but not told so',async()=>{
 const {store,query}=workspace('thin-quiet');
 const {result,note,writes,receipt}=await run(store,query,{write:()=>HEALTH});
 assert.equal(note.content,HEALTH);
 assert.ok(result.thin);
 assert.equal(receipt('brief-final-check').state,'thin');
 assert.equal(receipt('brief-final-check').thin_line,'not-needed');
 assert.ok(!writes.some(w=>w.phase==='thin-repair'));
});

test('the window, the news states and the thin check, one rule at a time',()=>{
 assert.deepEqual(newsWindow({previousBriefs:[],today:'2026-11-10'}),{search_start:'2026-11-08',recovery_gap_days:0,last_brief_at:null});
 assert.equal(newsWindow({previousBriefs:[{day:'2026-10-01',created_at:'2026-10-01T06:00:00Z'}],today:'2026-11-10'}).recovery_gap_days,MAX_GAP_DAYS);
 const span=newsWindow({previousBriefs:[{day:'2026-11-09',created_at:'2026-11-09T06:00:00Z'}],today:'2026-11-10'});
 assert.equal(classify({found_at:'2026-11-08T01:00:00Z'},span,'2026-11-10','UTC').state,'fresh');
 assert.deepEqual(classify({published:'2026-11-05',found_at:'2026-11-09T20:00:00Z'},span,'2026-11-10','UTC'),{state:'older',published:'2026-11-05',age_label:'from 5 November'});
 assert.equal(classify({published:'2026-11-05',found_at:'2026-11-09T05:00:00Z'},span,'2026-11-10','UTC').state,'stale');
 assert.equal(classify({published:'2026-12-01',found_at:'2026-11-09T20:00:00Z'},span,'2026-11-10','UTC').state,'fresh','a publication day in the future is not trusted');
 const context={action_artifacts:[{link:'/dashboard/notes/a'}],watch_findings:[{link:'https://x.invalid/1'}],source_receipts:[{url:'https://x.invalid/2',changed:true},{url:'https://x.invalid/3',changed:true,age_label:'from 1 November'}]};
 assert.equal(thinCheck('https://x.invalid/1 https://x.invalid/3',context).thin,true);
 assert.equal(thinCheck('https://x.invalid/1 https://x.invalid/2',context).thin,false);
 assert.equal(thinCheck('1. Decide on it.',context).thin,false);
 assert.equal(thinCheck('Good morning.\n\n1.\n\nHealth fine.',context).has_action,false,'a bare item number is no decision');
 assert.equal(thinCheck('See /dashboard/notes/a',context).thin,false);
});

test('draft items and sentence repair keep to their lines',async()=>{
 assert.deepEqual(draftItems('Opening.\n\nNews one.\nMore news.\n\n1. First.\nStill first.\n2. Second.'),[{start:0,end:1},{start:2,end:4},{start:5,end:7},{start:7,end:8}]);
 await assert.rejects(applyFindings('Required line.\n\nOther.',[{sentence:'Required line.',problem:'wording'}],{protectedLines:['Required line.'],rewrite:async()=>''}),/word for word/);
 const out=await applyFindings('Intro.\n\n1. Keep this. Fix this.\n2. Drop item.',[{sentence:'Drop item.',problem:'core-unsupported',reason:'r'},{sentence:'Fix this.',problem:'wording',reason:'w'}],{rewrite:async()=>'Fixed https://new.invalid'});
 assert.equal(out.text,'Intro.\n\n1. Keep this.','a rewrite that brings a new link is not used');
 const emptied=await applyFindings('Good morning.\n\n1. Only this.\n\nHealth fine.',[{sentence:'Only this.',problem:'wording',reason:'w'}],{rewrite:async()=>''});
 assert.equal(emptied.text,'Good morning.\n\nHealth fine.');
 assert.equal(emptied.changes[0].item_emptied,true);
});
