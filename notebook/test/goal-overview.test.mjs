import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {goalOverview,workItem} from '../core/goal-overview.mjs';

// The Goals page reads back what the loop did (18 October 2026): the weekly number and its readings,
// each bet and its verdict, today's decision, the work and whether its check passed, what went out,
// and the research brief with its limit.
const tools=fileURLToPath(new URL('../../tools/',import.meta.url));
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-overview-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
function original(t){
 const previous=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';
 t.after(()=>{if(previous===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=previous;});
}

test('the Goals page shows the weekly number, the bets and their verdicts, the decision, the work and the research',t=>{
 original(t);
 const root=temporary(t);fs.mkdirSync(path.join(root,'rules'));fs.writeFileSync(path.join(root,'AGENTS.md'),'# Fictional\n');
 const env={...process.env,GODSPEED_ROOT:root,GODSPEED_NOW:'2026-10-02T08:00:00.000Z'};
 const cli=(file,...args)=>execFileSync(process.execPath,[path.join(tools,file),...args,'--godspeed',root],{cwd:root,env,encoding:'utf8'});
 cli('goals.js','file','--kind','outcome','--status','adopted','--id','novel','--title','Finish my fictional novel','--source','test','--date','2026-10-01');
 cli('goals.js','change','novel','--set','LEAD=words in the draft | total | wc -w drafts/novel.md','--why','test','--date','2026-10-01');
 cli('goals.js','read','novel','1200','--where','wc -w drafts/novel.md','--date','2026-10-01');
 const w1=cli('work.js','file','--what','Write chapter two','--done-when','drafts/novel.md has chapter two','--goal','novel','--check','grep -q "Chapter two" drafts/novel.md','--source','test','--date','2026-10-01').split(':')[0];
 const w2=cli('work.js','file','--what','Outline chapter three','--done-when','drafts/outline.md has chapter three','--goal','novel','--check','grep -q "three" drafts/outline.md','--source','test','--date','2026-10-01').split(':')[0];
 fs.writeFileSync(path.join(root,'moves.md'),'### 1. Chapter two\nAPPLY: '+w1+'\nGOAL: novel\nBET: 1200 -> 2400\n');
 cli('goals.js','bets','--moves',path.join(root,'moves.md'),'--date','2026-10-01');
 fs.mkdirSync(path.join(root,'drafts'));fs.writeFileSync(path.join(root,'drafts','novel.md'),'Chapter two\n');
 cli('work.js','verify',w1,'--date','2026-10-01');
 fs.writeFileSync(path.join(root,'drafts','outline.md'),'nothing yet\n');
 cli('work.js','take',w2,'--runner','fixture','--date','2026-10-01');cli('work.js','attempt',w2,'--runner','fixture','--ok','--result','outlined','--date','2026-10-01');
 try{cli('work.js','verify',w2,'--date','2026-10-01');}catch{}
 cli('goals.js','read','novel','2600','--where','wc -w drafts/novel.md','--date','2026-10-08');
 cli('goals.js','settle','--date','2026-10-08');
 const brief=path.join(root,'goals','research','novel','brief.md');
 fs.writeFileSync(brief,fs.readFileSync(brief,'utf8').replace('## The limit now\nnothing named','## The limit now\nLIMIT: no fixed daily writing slot'));
 fs.mkdirSync(path.join(root,'routines','next-action','2026-10-08'),{recursive:true});
 fs.writeFileSync(path.join(root,'routines','next-action','2026-10-08','decision.md'),'# Decision 2026-10-08\n## Scoreboard\nnovel: 2600 words, the chapter-two move worked.\n## novel\nThe draft grew by 1,400 words; next, chapter three.\n## For you today\nnothing today, because the work runs on its own\n');
 const store=new Store(root,{device:'fixture'}),query=new QueryService(store);query.nativeHermesHome=path.join(root,'hermes');
 store.save('settings',{id:'installation',owner:'fixture',timezone:'UTC',delivery:'notebook'});
 const view=goalOverview({store,query,now:new Date('2026-10-08T12:00:00Z')});
 assert.equal(view.today,'2026-10-08');
 assert.deepEqual({day:view.decision.day,today:view.decision.today,for_you:view.decision.for_you},{day:'2026-10-08',today:true,for_you:'nothing today, because the work runs on its own'});
 const [novel]=view.goals;
 assert.equal(novel.lead.what,'words in the draft');
 assert.deepEqual(novel.readings.map(r=>[r.date,r.value]),[['2026-10-01',1200],['2026-10-08',2600]]);
 assert.equal(novel.bets[0].what,'Write chapter two');assert.equal(novel.bets[0].result.verdict,'worked');
 assert.equal(novel.decision,'The draft grew by 1,400 words; next, chapter three.');
 assert.equal(novel.research.brief.limit,'no fixed daily writing slot');
 const done=novel.work.find(w=>w.id===w1),open=novel.work.find(w=>w.id===w2);
 assert.equal(done.status,'verified');assert.equal(done.verified.date,'2026-10-01');assert.match(done.verified.how,/check passed/);
 assert.equal(open.status,'attempted');assert.match(open.unverified.why,/check failed/);
 // Read only: nothing on file changed.
 const before=fs.readdirSync(path.join(root,'goals')).map(f=>f).join();
 goalOverview({store,query,now:new Date('2026-10-08T12:00:00Z')});
 assert.equal(fs.readdirSync(path.join(root,'goals')).join(),before);
});

test('a step that went out on a standing permission shows as went out, a stopped one with the words',()=>{
 const went=workItem({id:'W-1',STATUS:'verified',WHAT:'Put chapter one on the site',OUTWARD:'yes',MAY:'site-chapter',APPROVED:'standing site-chapter: "yes"','GOES OUT':'2026-10-02T18:00',ANNOUNCED:'2026-10-02',log:[{date:'2026-10-02',event:'VERIFIED',rest:'check passed (test -f site/1.html)'}]});
 assert.deepEqual({outward:went.outward,standing:went.standing,verified:went.verified.date},{outward:true,standing:'site-chapter',verified:'2026-10-02'});
 const stopped=workItem({id:'W-2',STATUS:'cancelled',WHAT:'x',log:[{date:'2026-10-02',event:'STOPPED',rest:'"not this one"'}]});
 assert.equal(stopped.stopped.words,'"not this one"');
});

test('the Goals page answers through the server, in the record runtime too',async t=>{
 const previous=process.env.GODSPEED_ORIGINAL_RUNTIME;delete process.env.GODSPEED_ORIGINAL_RUNTIME;
 t.after(()=>{if(previous!==undefined)process.env.GODSPEED_ORIGINAL_RUNTIME=previous;});
 const {createService}=await import('../server/main.mjs');
 const root=temporary(t),service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 try{
  service.store.save('goals',{title:'Fictional chapters',status:'adopted',lead:'chapters drafted | total | the draft folder',progress:[]});
  const r=await fetch(base+'/api/goals/overview'),data=await r.json();
  assert.equal(r.status,200,JSON.stringify(data));
  assert.equal(data.goals.length,1);assert.equal(data.goals[0].lead.kind,'total');assert.equal(data.ai.available,false);
 }finally{await service.close();}
});
