import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {rememberWhatYouSaid} from '../core/memory-daily.mjs';

const now=new Date('2026-11-07T04:00:00Z');
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-daily-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'prompts','archive'),{recursive:true});return root;};
const archive=(root,rows)=>fs.writeFileSync(path.join(root,'prompts','archive','laptop-2026-11.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
const answer=row=>({facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-01',one_or_many:'one',confidence:'certain',citation:{id:row.id,quote:'I moved to Hamburg on 1 November'}}],people:[],things:[],events:[]});

test('the daily memory files a dated quoted fact once and retains the fact it replaces',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query);domains.writeFact({label:'Home city',value:'Kiel',valid_from:'2026-01-01'});
 const row={id:'moved',at:'2026-11-01T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let calls=0;
 const run=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return answer(row);}});
 assert.equal(run.completed,1);assert.equal(calls,1);const facts=query.rows('claims').filter(f=>f.attribute==='lives-in');assert.equal(facts.length,2);assert.equal(facts.find(f=>f.value==='Kiel').valid_to,'2026-11-01');assert.equal(facts.find(f=>f.value==='Hamburg').evidence_quote,row.text);
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return answer(row);}});assert.equal(calls,1,'a consumed archive row is never sent again');
});

test('invalid quotes and machine prompts are refused without filing them',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query);const human={id:'human',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},machine={id:'machine',at:'2026-11-02T13:00:00Z',text:'[CRON RUN] never send this'};archive(root,[human,machine]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-01',citation:{id:'human',quote:'not in the message'}}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);const state=JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json')));assert.ok(state.consumed.includes('machine'));assert.ok(state.consumed.includes('human'));
});

test('a failed model piece remains eligible for the next night',async t=>{
 const root=workspace(t),row={id:'retry',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let calls=0;
 const failed=await rememberWhatYouSaid({root,now,model:async()=>{calls++;throw Error('offline');}});assert.equal(failed.failed,1);assert.equal(calls,3);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed,[]);
 const done=await rememberWhatYouSaid({root,now,model:async()=>answer(row)});assert.equal(done.completed,1);assert.ok(fs.existsSync(path.join(root,'world','claims')),'a starter writes the world fallback');
});

test('a refused deadline leaves its prepared piece unread and recovery does not ask the model again',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'done',at:'2026-11-02T12:00:00Z',text:'I filed the tax return today; keep this private detail out of the receipt'};archive(root,[row]);
 const reply={facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-02',citation:{id:'done',quote:'I filed the tax return today'}}],events:[{what:'Filed the tax return',day:'2026-11-02',deadline_id:'tax',citation:{id:'done',quote:'I filed the tax return today'}}]};let calls=0;
 const first=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[{slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'}],model:async()=>{calls++;return reply;},due:async()=>false});
 assert.equal(first.completed,0);assert.equal(query.rows('claims').length,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed,[]);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'routines','remember-what-you-said','pending',fs.readdirSync(path.join(root,'routines','remember-what-you-said','pending'))[0]),'utf8'),/private detail/,'the pending receipt retains IDs and quotes only');
 const second=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[{slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'}],model:async()=>{calls++;return reply;},due:async()=>true});
 assert.equal(second.completed,1);assert.equal(calls,1);assert.equal(query.rows('claims').length,1);
});
