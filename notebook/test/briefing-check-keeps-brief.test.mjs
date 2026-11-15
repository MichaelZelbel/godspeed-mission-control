// THE SOURCE CHECK NEVER COSTS THE PERSON THEIR BRIEF (#491). In the nightly run of 13 November 2026
// the AI opened the brief with "nothing from the calendar needs attention" while no calendar was read;
// the source check refused it, naming no record (there is none to name), and the routine exited 1
// with no brief at all. Now the refused sentence is dropped and the rest is saved, and when nothing
// passes the short honest note is saved, built from no fact of the sources. Everything here is made up.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import http from 'node:http';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {jobExecutor} from '../core/runtime.mjs';

const CALENDAR='Nothing from the calendar needs attention.';
const REST='Next: review the fictional reading list and pick one chapter.';
function workspace(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-brief-check-keeps-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const store=new Store(root);store.save('settings',{id:'installation',timezone:'Europe/Berlin'});
 fs.mkdirSync(path.join(root,'profile'),{recursive:true});fs.writeFileSync(path.join(root,'profile','voice.md'),'# Voice\n\n```voice-rules\n\n```\n');
 store.save('goals',{title:'Read the fictional reading list',status:'adopted'});
 return {root,store,query:new QueryService(store)};
}
const briefs=query=>query.rows('notes').filter(n=>n.source_app==='morning-brief');

test('a calendar claim with no calendar read is dropped, and the rest of the brief is saved',async t=>{
 const {store,query}=workspace(t);let refused=0;
 const provider=async input=>{
  if(input.kind==='brief-verification'){
   const draft=input.context.draft;
   if(input.check==='source-facts'&&draft.includes(CALENDAR)){refused++;return {passed:false,reason:'No calendar read appears in the sources.',rejection_scope:'source-claims',rejected_source_ids:[],findings:[{sentence:CALENDAR,problem:'core-unsupported',reason:'No calendar read appears in the sources.'}]};}
   return {passed:true,reason:'Fictional sources checked.'};
  }
  if(input.kind==='brief-sentence-repair')return {sentence:''};
  return CALENDAR+'\n\n'+REST;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-calendar-claim'},{store,settings:{}});
 const saved=store.get('notes',result.record_id);
 assert.ok(refused>=2,'the source check refused the claim on the draft and on its rewrite');
 assert.doesNotMatch(saved.content,/calendar/i);assert.match(saved.content,/review the fictional reading list/);
 assert.equal(result.fallback,undefined,'what passed is the brief, not the fallback');
 assert.equal(briefs(query).length,1);assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,1);
});

const SAME='The fictional garden club meets on Saturday.',OTHER='Health: the fictional step count is steady.';
for(const [shape,draft,kept] of [['the whole brief is that one paragraph',CALENDAR+' '+SAME+' '+REST,[SAME+' '+REST]],['the brief has other paragraphs',CALENDAR+' '+SAME+' '+REST+'\n\n'+OTHER,[SAME+' '+REST,OTHER]]])
test('a refused sentence inside a paragraph goes alone, and the paragraph keeps what passed, when '+shape+' (#500)',async t=>{
 const {store,query}=workspace(t);let refused=0;
 const provider=async input=>{
  if(input.kind==='brief-verification'){
   const text=input.context.draft;
   if(input.check==='source-facts'&&text.includes(CALENDAR)){refused++;return {passed:false,reason:'No calendar read appears in the sources.',rejection_scope:'source-claims',rejected_source_ids:[],findings:[{sentence:CALENDAR,problem:'core-unsupported',reason:'No calendar read appears in the sources.'}]};}
   return {passed:true,reason:'Fictional sources checked.'};
  }
  if(input.kind==='brief-sentence-repair')return {sentence:''};
  return draft;
 };
 const result=await jobExecutor(provider,query)({kind:'morning-brief',id:'brief-calendar-in-paragraph'},{store,settings:{}});
 const saved=store.get('notes',result.record_id);
 assert.ok(refused>=2,'the source check refused the claim on the draft and on its rewrite');
 assert.equal(result.fallback,undefined,'what passed is the brief, not the honest note');
 assert.doesNotMatch(saved.content,/calendar/i,'the refused sentence never reaches the brief');
 for(const text of kept)assert.ok(saved.content.includes(text),'kept: '+text);
 const repair=query.rows('job_receipts').filter(r=>r.kind==='brief-repair').at(-1);
 assert.equal(repair.state,'verified',repair.error);
 assert.deepEqual(repair.changes.map(c=>[c.action,c.sentence]),[['drop-sentence',CALENDAR]]);
 assert.equal(briefs(query).length,1);assert.equal(query.rows('notifications').filter(n=>n.status==='ready').length,1);
});

test('when the source check refuses every sentence, the honest note is saved and the routine exits 0',async t=>{
 const {root}=workspace(t);
 // Every draft is refused, as last night: a source claim with no record named and no sentence named.
 const server=http.createServer((request,response)=>{let body='';request.on('data',c=>body+=c);request.on('end',()=>{
  const input=JSON.parse(JSON.parse(body).messages[1].content);
  const answer=input.check==='source-facts'?{passed:false,reason:'No calendar read appears in the sources.',rejection_scope:'source-claims',rejected_source_ids:[]}:input.check?{passed:true,reason:'Clear.'}:CALENDAR+'\n\n'+REST;
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify({choices:[{message:{content:typeof answer==='string'?answer:JSON.stringify(answer)}}]}));
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});
 fs.writeFileSync(path.join(root,'.godspeed','provider.json'),JSON.stringify({url:`http://127.0.0.1:${server.address().port}/v1/chat/completions`,key:'made-up',model:'made-up'}));
 const script=fileURLToPath(new URL('../scripts/morning-brief.mjs',import.meta.url));
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',script,'--godspeed',root],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_ASSISTANT_CONFIG:path.join(root,'none.json')}});
 let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
 const timer=setTimeout(()=>child.kill(),120000);
 const status=await new Promise(resolve=>child.on('close',resolve));clearTimeout(timer);
 assert.equal(status,0,stderr);
 assert.match(stdout,/^Your full morning briefing for \d{4}-\d{2}-\d{2} could not be written today, because the checks refused what was drafted\. A repair item has been opened for it\.\s*$/);
 const fresh=new QueryService(new Store(root)),notes=briefs(fresh);
 assert.equal(notes.length,1);assert.equal(notes[0].fallback,true);assert.equal(notes[0].content.trim(),stdout.trim());
 assert.doesNotMatch(notes[0].content,/calendar|reading list/i,'the note states nothing from the sources');
 const receipt=fresh.rows('job_receipts').find(r=>r.kind==='brief-factual-fallback');
 assert.equal(receipt.honest_note,true);assert.match(receipt.rejected_draft,/calendar/);
 assert.equal(fresh.rows('work_items').filter(w=>w.kind==='repair'&&w.note_id===notes[0].id).length,1);
});
