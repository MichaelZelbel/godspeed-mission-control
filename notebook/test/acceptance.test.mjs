import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,atomic} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {ApiKeys} from '../core/api-keys.mjs';
import {Telegram} from '../core/telegram.mjs';
import {createService} from '../server/main.mjs';
import {procedure} from '../core/procedures.mjs';
import {backup,restore} from '../core/archives.mjs';
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-acceptance-'));
test('full world relationships, conflicting dated facts and cardinality preserve current and historical meaning',()=>{
 const store=new Store(temporary()),query=new QueryService(store),domains=new Domains(query);
 const a=store.save('contacts',{name:'Alex Example',ai_visibility:'visible'}),b=store.save('contacts',{name:'Robin Example',ai_visibility:'visible'});
 query.execute({table:'contact_relationships',operation:'insert',values:{source_type:'contact',source_id:a.id,target_type:'contact',target_id:b.id,label:'friend',valid_from:'2026-01-01'}});
 domains.writeFact({contact_id:a.id,label:'City',value:'Example City',valid_from:'2025-01-01'});
 domains.writeFact({contact_id:a.id,label:'City',value:'New Example City',valid_from:'2026-01-01'});
 const fact=query.rows('claims').find(c=>!c.valid_to);query.execute({table:'claims',operation:'insert',values:{...fact,id:undefined,uid:undefined,value:'Conflicting Example City'}});
 assert.equal(query.rows('profile_facts').filter(f=>f.is_current&&f.has_conflict).length,2);
 const world=query.rows('world_claims');assert.equal(world.find(r=>r.source_table==='contact_relationship').confidence,'confirmed');assert.equal(world.find(r=>r.source_table==='contact_relationship').object_id,b.id);assert.equal(world.find(r=>r.source_table==='claim').subject_kind,'contact');
 query.execute({table:'fact_slots',operation:'update',values:{cardinality:'many'},filters:[['eq','attribute',fact.attribute]]});assert.ok(query.rows('profile_facts').every(f=>!f.has_conflict));
 assert.equal(query.rows('claims').find(c=>c.value==='Example City').valid_to,'2026-01-01');
});
test('privacy and credential rules prevent hidden source processing and secret records',async()=>{
 const store=new Store(temporary()),query=new QueryService(store),domains=new Domains(query,{provider:()=>{throw new Error('Provider must not see this source')}});
 const person=store.save('contacts',{name:'Sensitive Example',is_sensitive:true}),note=store.save('notes',{title:'Private source',content:'Private fixture text'});
 query.execute({table:'person_documents',operation:'insert',values:{contact_id:person.id,note_id:note.id}});
 await assert.rejects(domains.invoke('process-note',{note_id:note.id}),/Source note missing/);
 assert.throws(()=>query.execute({table:'connected_apps',operation:'insert',values:{api_key:'synthetic-never-sync'}}),/credentials/);
 const keys=new ApiKeys(store),generated=keys.invoke('mc-api-keys/generate',{name:'Read fixture',scopes:['notes']});assert.ok(keys.authenticate(generated.api_key));assert.ok(!JSON.stringify(keys.invoke('mc-api-keys',{})).includes(generated.api_key));keys.invoke('mc-api-keys/'+generated.id,{});assert.equal(keys.authenticate(generated.api_key),undefined);
});
test('one-time login links expire after use and API scopes are enforced by real HTTP',async()=>{
 const service=await createService({root:temporary(),host:'0.0.0.0',port:0,token:'synthetic-test-owner'}),origin='http://127.0.0.1:'+service.address.port;
 try{
  const invitation=await(await fetch(origin+'/api/auth/bootstrap',{method:'POST',body:JSON.stringify({token:'synthetic-test-owner'})})).json();
  const invite=new URLSearchParams(invitation.path.split('#')[1]).get('invite');
  const login=await fetch(origin+'/api/auth/setup',{method:'POST',body:JSON.stringify({invite,username:'test-owner',password:'synthetic test password'})}),cookie=login.headers.get('set-cookie').split(';')[0];
  const link=await(await fetch(origin+'/api/login-link',{method:'POST',headers:{Cookie:cookie}})).json();assert.equal((await fetch(origin+link.path,{redirect:'manual'})).status,303);assert.equal((await fetch(origin+link.path,{redirect:'manual'})).status,401);
  const key=await(await fetch(origin+'/api/functions/mc-api-keys/generate',{method:'POST',headers:{Cookie:cookie},body:JSON.stringify({name:'Notes only',scopes:['notes']})})).json();
  const denied=await fetch(origin+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+key.data.api_key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'write_fact',arguments:{label:'Private fixture',value:'No'}}})});assert.equal(denied.status,403);
 }finally{await service.close();}
});
test('candidate Telegram acknowledges owner captures once and never replays uncertain sends',async()=>{
 const store=new Store(temporary()),query=new QueryService(store),domains=new Domains(query),updates=[{update_id:1,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'/capture One synthetic note'}},{update_id:2,message:{from:{id:456,is_bot:false},chat:{id:456,type:'private'},text:'/capture Wrong account'}}];let sends=0;
 const transport=async(url,options)=>({ok:true,json:async()=>url.endsWith('getUpdates')?{ok:true,result:updates}:{ok:true,result:{message_id:++sends}}});
 const bot=new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport});await bot.tick();await bot.tick();assert.equal(sends,1);assert.equal(query.rows('notes').length,1);assert.equal(store.get('command_receipts','telegram-1').state,'verified');
 const failed=new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport:async url=>{if(url.endsWith('sendMessage'))throw new Error('Network uncertainty');return {ok:true,json:async()=>({ok:true,result:[{update_id:3,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'/capture Uncertain send'}}]})};}});await failed.tick();await failed.tick();assert.equal(store.get('command_receipts','telegram-3').state,'needs_review');assert.equal(query.rows('notes').length,2);
});
test('health, disk and routine checks produce verified artifacts without a model',async()=>{
 const store=new Store(temporary()),query=new QueryService(store);store.save('health_observations',{observed_at:new Date().toISOString(),metric:'sleep_hours',value:7.5});store.save('medications',{taken_at:new Date().toISOString(),name:'Synthetic medicine',dose:'Reported amount'});
 for(const kind of ['health-summary','disk-check','selftest','job-check','attention-review'])assert.ok((await procedure({id:kind,kind},{store,query})).verified);
 const health=query.rows('notes').find(n=>n.source_app==='health-summary');assert.equal(JSON.parse(health.content).medication_days_last_30_days,1);
 const media=temporary(),saved=temporary()+'/backup';backup(store,media,saved);const target=new Store(temporary());restore(target,temporary(),saved);assert.equal(target.list('health_observations')[0].value,7.5);
});
test('disk-full failure keeps the previous completed record readable',()=>{
 const store=new Store(temporary()),old=store.save('notes',{title:'Completed before disk filled',content:'Retained content'}),open=fs.openSync;
 try{fs.openSync=(file,...args)=>{if(String(file).endsWith('.tmp'))throw Object.assign(new Error('No space left'),{code:'ENOSPC'});return open(file,...args);};assert.throws(()=>store.save('notes',{id:old.id,content:'Unpublished change'}),/No space left/);}finally{fs.openSync=open;}
 assert.equal(new Store(store.root).get('notes',old.id).content,'Retained content');
});
