import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {validateConversationOperations} from '../core/personal-operations.mjs';

// A number the person gives for a goal's weekly number reaches the goal as a READ line, the only
// reading mc-goals settle judges a move by (18 October 2026). Until then "Record the outcome" kept it
// in a PROGRESS line, where settle never looks, and no move of such a goal could get a verdict.
const goalsJs=fileURLToPath(new URL('../../tools/goals.js',import.meta.url));
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-readings-'));
const today=new Date().toISOString().slice(0,10);
function original(t){
 const root=temporary();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'rules'));fs.writeFileSync(path.join(root,'AGENTS.md'),'# Fictional mission control\n');
 const previous=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';
 t.after(()=>{if(previous===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=previous;});
 const goals=(...args)=>execFileSync(process.execPath,[goalsJs,...args,'--godspeed',root],{env:{...process.env,GODSPEED_ROOT:root},encoding:'utf8'});
 goals('file','--kind','outcome','--status','adopted','--id','novel','--title','Finish the first draft of my fictional novel','--source','test','--date','2026-10-01');
 goals('change','novel','--set','LEAD=words in the draft | total | wc -w drafts/novel.md','--why','test','--date','2026-10-01');
 goals('file','--kind','outcome','--status','adopted','--id','garden','--title','A fictional garden','--source','test','--date','2026-10-01');
 const store=new Store(root,{device:'fixture'}),query=new QueryService(store);query.nativeHermesHome=path.join(root,'hermes');
 store.save('settings',{id:'installation',owner:'fixture',timezone:'UTC',delivery:'notebook'});
 return {root,store,query,domains:new Domains(query),card:id=>fs.readFileSync(path.join(root,'goals',id+'.md'),'utf8')};
}

test('a reading entered in the notebook lands on the goal card as this week\'s reading',async t=>{
 const {root,domains,card}=original(t);
 const result=await domains.invoke('personal-operation',{type:'goal-reading',id:'novel',value:1400});
 assert.deepEqual(result.reading,{date:today,value:1400,where:'you entered it in the notebook'});
 assert.match(card('novel'),new RegExp('^- '+today+' READ 1400 \\(you entered it in the notebook\\)$','m'));
 await domains.invoke('personal-operation',{type:'goal-reading',id:'novel',value:'1650',where:'counted the draft myself',on:'2026-10-02'});
 assert.match(card('novel'),/^- 2026-10-02 READ 1650 \(counted the draft myself\)$/m);
 // mc-goals reads them back as readings, the ones settle judges by.
 const [status]=JSON.parse(execFileSync(process.execPath,[goalsJs,'status','novel','--json','--date',today,'--godspeed',root],{env:{...process.env,GODSPEED_ROOT:root},encoding:'utf8'}));
 assert.deepEqual(status.readings.map(r=>[r.date,r.value]),[['2026-10-02',1650],[today,1400]]);
});

test('a measured outcome of a goal with a weekly number is a reading too; without one it stays progress',async t=>{
 const {domains,card}=original(t);
 await domains.invoke('personal-operation',{type:'goal-outcome',id:'novel',evidence:'I counted the draft',value:2100});
 assert.match(card('novel'),/ PROGRESS I counted the draft$/m);
 assert.match(card('novel'),new RegExp('^- '+today+' READ 2100 ','m'));
 await domains.invoke('personal-operation',{type:'goal-outcome',id:'garden',evidence:'Planted three beds',value:3});
 assert.match(card('garden'),/ PROGRESS Planted three beds$/m);
 assert.doesNotMatch(card('garden'),/ READ /);
});

test('a reading is refused for a goal without a weekly number, a value that is not a number and a day ahead',async t=>{
 const {domains,card}=original(t);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-reading',id:'garden',value:3}),/no weekly number yet/);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-reading',id:'novel',value:'many'}),/plain number/);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-reading',id:'novel',value:5,on:'2999-01-01'}),/after today/);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-reading',id:'nosuch',value:5}),/existing goal/);
 assert.doesNotMatch(card('novel'),/ READ /);
});

test('a weekly number can be named from the notebook, in its three parts',async t=>{
 const {domains,card}=original(t);
 await domains.invoke('personal-operation',{type:'goal-change',id:'garden',lead:'beds planted | total | I count them',reason:'Named on the Goals page'});
 assert.match(card('garden'),/^LEAD: beds planted \| total \| I count them$/m);
 await assert.rejects(domains.invoke('personal-operation',{type:'goal-change',id:'garden',lead:'beds | someday | eyes',reason:'test'}),/total or per week/);
});

test('in the chat a reading must be a number the person said, for a goal that has a weekly number',t=>{
 const {domains}=original(t);
 const message='I wrote 1,400 words this week for my novel';
 validateConversationOperations(domains,{message},[{type:'goal-reading',id:'novel',value:1400,source_quote:message}]);
 assert.throws(()=>validateConversationOperations(domains,{message},[{type:'goal-reading',id:'novel',value:1500,source_quote:message}]),/number you said/);
 assert.throws(()=>validateConversationOperations(domains,{message:'I planted 3 beds'},[{type:'goal-reading',id:'garden',value:3,source_quote:'I planted 3 beds'}]),/no weekly number/);
 assert.throws(()=>validateConversationOperations(domains,{message:'Don\'t record 1400 for my novel'},[{type:'goal-reading',id:'novel',value:1400,source_quote:'Don\'t record 1400 for my novel'}]),/explicit request/);
});

test('in the record runtime a reading reaches the goal\'s card log as well',async t=>{
 const root=temporary();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const previous=process.env.GODSPEED_ORIGINAL_RUNTIME;delete process.env.GODSPEED_ORIGINAL_RUNTIME;
 t.after(()=>{if(previous!==undefined)process.env.GODSPEED_ORIGINAL_RUNTIME=previous;});
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);
 const goal=store.save('goals',{title:'Fictional chapters',status:'adopted',lead:'chapters drafted | total | the draft folder',progress:[]});
 await domains.invoke('personal-operation',{type:'goal-reading',id:goal.id,value:4});
 const log=store.get('goals',goal.id).legacy_log||[];
 assert.ok(log.some(l=>l.event==='READ'&&l.rest==='4 (you entered it in the notebook)'),JSON.stringify(log));
});
