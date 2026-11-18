import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {procedure} from '../core/procedures.mjs';
import {addDomainWatch,listDomainWatches,removeDomainWatch,pendingDeliveries,telegramDeliveryReceiptId} from '../core/domain-watch.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';
import {Telegram} from '../core/telegram.mjs';
import {createService} from '../server/main.mjs';

const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-watch-'))),query=new QueryService(store);return {store,query};};
const rdap=status=>new Response(JSON.stringify({status}),{status:200,headers:{'Content-Type':'application/rdap+json'}});

test('domain watch records each successful state and notices each transition once',async()=>{
 const {store,query}=setup();addDomainWatch(store,' Example.COM. ');let state=['active'],calls=[];
 const fetcher=async(url,init)=>{calls.push({url:String(url),headers:init.headers});return rdap(state);};
 await procedure({kind:'domain-watch'},{store,query,fetcher});
 state=['pendingDelete'];await procedure({kind:'domain-watch'},{store,query,fetcher});await procedure({kind:'domain-watch'},{store,query,fetcher});
 state=null;const available=async(url,init)=>{calls.push({url:String(url),headers:init.headers});return new Response(null,{status:404});};
 await procedure({kind:'domain-watch'},{store,query,fetcher:available});
 state=['active'];await procedure({kind:'domain-watch'},{store,query,fetcher});await procedure({kind:'domain-watch'},{store,query,fetcher});
 assert.deepEqual(store.list('domain_watch_observations').sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(o=>o.state),['registered','pending delete','pending delete','available','registered','registered']);
 const notices=store.list('notifications');assert.equal(notices.length,3);assert.ok(notices.some(n=>/released in about five days/.test(n.body)));assert.ok(notices.some(n=>/registered now, at any registrar/.test(n.body)));assert.ok(notices.some(n=>/registered again/.test(n.body)));
 assert.ok(calls.every(c=>c.url==='https://rdap.verisign.com/com/v1/domain/example.com'));
 assert.equal(calls[0].headers.Accept,'application/rdap+json');assert.match(calls[0].headers['User-Agent'],/Godspeed/);
});

test('RDAP fallback and total failure preserve the latest successful state',async()=>{
 const {store,query}=setup();addDomainWatch(store,'wanted.org');let called=[];
 await procedure({kind:'domain-watch'},{store,query,fetcher:async url=>{called.push(String(url));if(called.length===1)throw Error('offline');return rdap(['redemptionPeriod']);}});
 assert.deepEqual(called,['https://rdap.org/domain/wanted.org','https://www.rdap.net/domain/wanted.org']);
 const before=store.list('domain_watch_observations').length,result=await procedure({kind:'domain-watch'},{store,query,fetcher:async()=>{throw Error('offline');}});
 assert.equal(result.verified,true);assert.equal(result.domains[0].ok,false);assert.equal(store.list('domain_watch_observations').length,before);assert.equal(store.list('domain_watches')[0].state,'redemption');assert.equal(store.list('notifications').length,0);
});

test('.net uses Verisign and domain lifecycle uses one six-hour sweeper',async()=>{
 const {store,query}=setup();const first=addDomainWatch(store,'Bücher.net');addDomainWatch(store,'second.example');
 assert.equal(first.domain,'xn--bcher-kva.net');assert.equal(store.list('jobs').length,1);assert.equal(store.list('jobs')[0].interval_ms,21600000);
 let urls=[];await procedure({kind:'domain-watch'},{store,query,fetcher:async url=>{urls.push(String(url));return rdap(['active']);}});
 assert.ok(urls.includes('https://rdap.verisign.com/net/v1/domain/xn--bcher-kva.net'));
 removeDomainWatch(store,'BÜCHER.NET');assert.deepEqual(listDomainWatches(store).map(w=>w.domain),['second.example']);
 const restored=addDomainWatch(store,'bücher.net');assert.equal(restored.id,first.id);assert.equal(restored.removed_at,null);assert.equal(store.list('jobs').length,1);
 await assert.rejects(async()=>addDomainWatch(store,'bücher.net'),/already/);
});

test('the scheduler runs domain watches without page-topic due rules and schedules six hours later',async()=>{
 const {store,query}=setup(),at=Date.parse('2026-11-17T12:00:00Z');store.save('settings',{id:'installation',owner:store.device,timezone:'UTC',delivery:'notebook'});addDomainWatch(store,'scheduled.test');store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at).toISOString()});
 const scheduler=new Scheduler(store,{query,executor:job=>procedure(job,{store,query,fetcher:async()=>rdap(['active'])})});
 await scheduler.tick(at);assert.equal(store.list('domain_watch_observations').length,1);assert.equal(Date.parse(store.get('jobs','domain-watch-sweeper').next_run),at+21600000);
});

test('the scheduler delivers a saved transition through Telegram and retries a total outage next slot',async()=>{
 const {store,query}=setup(),at=Date.parse('2026-11-17T12:00:00Z');store.save('settings',{id:'installation',owner:store.device,timezone:'UTC',delivery:'telegram'});addDomainWatch(store,'delivery.test');
 await procedure({kind:'domain-watch'},{store,query,fetcher:async()=>rdap(['active'])});store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at).toISOString()});
 const sent=[],telegram=new Telegram({store,domains:null,token:'token',owner:'1',transport:async(_url,input)=>{sent.push(JSON.parse(String(input.body)));return new Response(JSON.stringify({ok:true,result:{message_id:7}}),{status:200,headers:{'Content-Type':'application/json'}});}});
 const scheduler=new Scheduler(store,{query,delivery:'telegram',executor:job=>procedure(job,{store,query,fetcher:async()=>rdap(['pendingDelete'])})});scheduler.deliver=telegram.deliver.bind(telegram);
 await scheduler.tick(at);assert.equal(sent.length,1);assert.match(sent[0].text,/delivery\.test is now pending delete/);assert.equal(store.get('jobs','domain-watch-sweeper').last_outcome,'verified');
 store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at+21600000).toISOString()});scheduler.executor=job=>procedure(job,{store,query,fetcher:async()=>rdap(['pendingDelete'])});
 await scheduler.tick(at+21600000);assert.equal(sent.length,1);
 store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at+43200000).toISOString()});scheduler.executor=job=>procedure(job,{store,query,fetcher:async()=>{throw Error('offline');}});
 await scheduler.tick(at+43200000);assert.equal(store.get('jobs','domain-watch-sweeper').state,'pending');assert.equal(store.get('jobs','domain-watch-sweeper').last_outcome,'verified');assert.equal(Date.parse(store.get('jobs','domain-watch-sweeper').next_run),at+64800000);assert.equal(sent.length,1);
});

test('the scheduler delivers every bounded message in a large transition batch',async()=>{
 const {store,query}=setup(),at=Date.parse('2026-11-17T12:00:00Z');store.save('settings',{id:'installation',owner:store.device,timezone:'UTC',delivery:'telegram'});
 const domains=Array.from({length:45},(_,index)=>'wanted-'+String(index).padStart(2,'0')+'-'+('x'.repeat(45))+'.example');
 for(const domain of domains)addDomainWatch(store,domain);
 await procedure({kind:'domain-watch'},{store,query,fetcher:async()=>rdap(['active'])});store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at).toISOString()});
 const sent=[],telegram=new Telegram({store,domains:null,token:'token',owner:'1',transport:async(_url,input)=>{const body=JSON.parse(String(input.body));sent.push(body.text);return new Response(JSON.stringify({ok:true,result:{message_id:sent.length}}),{status:200,headers:{'Content-Type':'application/json'}});}});
 const scheduler=new Scheduler(store,{query,delivery:'telegram',executor:job=>procedure(job,{store,query,fetcher:async()=>rdap(['pendingDelete'])})});scheduler.deliver=telegram.deliver.bind(telegram);
 await scheduler.tick(at);
 assert.ok(sent.length>1);assert.ok(sent.every(text=>text.length<=4000));
 for(const domain of domains)assert.equal(sent.filter(text=>text.includes(domain+' is now pending delete')).length,1);
 assert.equal(store.get('jobs','domain-watch-sweeper').last_outcome,'verified');
});

test('after one batch is delivered and the next is uncertain, the next run delivers the rest exactly once',async()=>{
 const {store,query}=setup(),at=Date.parse('2026-11-17T12:00:00Z');store.save('settings',{id:'installation',owner:store.device,timezone:'UTC',delivery:'telegram'});
 const domains=Array.from({length:40},(_,index)=>'partial-'+String(index).padStart(2,'0')+'-'+'x'.repeat(50)+'.'+'y'.repeat(60)+'.example');
 for(const domain of domains)addDomainWatch(store,domain);
 await procedure({kind:'domain-watch'},{store,query,fetcher:async()=>rdap(['active'])});store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at).toISOString()});
 let attempted=[],sends=0;const telegram=new Telegram({store,domains:null,token:'token',owner:'1',transport:async(_url,input)=>{
  const text=JSON.parse(String(input.body)).text;attempted.push(text);
  if(++sends===2)throw Error('connection lost');
  return new Response(JSON.stringify({ok:true,result:{message_id:attempted.length}}),{status:200,headers:{'Content-Type':'application/json'}});
 }});
 const scheduler=new Scheduler(store,{query,delivery:'telegram',executor:job=>procedure(job,{store,query,fetcher:async()=>rdap(['pendingDelete'])})});scheduler.deliver=telegram.deliver.bind(telegram);
 await scheduler.tick(at);
 const first=store.list('job_receipts').find(item=>item.job_id==='domain-watch-sweeper'),batches=first.delivery_record_ids;
 assert.ok(batches.length>=3);assert.equal(attempted.length,2);
 // The sweeper is not held for a review nothing offers: it keeps its next six-hour slot.
 const held=store.get('jobs','domain-watch-sweeper');assert.equal(held.paused,false);assert.notEqual(held.state,'needs_review');assert.equal(Date.parse(held.next_run),at+21600000);assert.match(held.last_outcome,/not sent again/);
 assert.equal(store.get('command_receipts',telegramDeliveryReceiptId(store.get('notes',batches[0]))).state,'verified');
 assert.equal(store.get('command_receipts',telegramDeliveryReceiptId(store.get('notes',batches[1]))).state,'needs_review');
 assert.deepEqual(pendingDeliveries(store),batches.slice(2));
 // Nothing touches the job: the scheduler's next tick at the usual time runs it. RDAP answers as before, so no domain changes.
 const later=at+21600000;await scheduler.tick(later-60000);assert.equal(store.list('job_receipts').filter(item=>item.job_id==='domain-watch-sweeper').length,1);
 const firstRun=attempted;attempted=[];
 await scheduler.tick(later);
 assert.equal(store.get('jobs','domain-watch-sweeper').last_outcome,'verified');
 assert.deepEqual(attempted,batches.slice(2).map(id=>store.get('notes',id).content));
 for(const domain of domains){
  const sent=[...firstRun,...attempted].filter(text=>text.includes(domain+' is now pending delete')).length;
  assert.equal(sent,1,domain);
 }
 assert.deepEqual(pendingDeliveries(store),[]);
 // A further unchanged run sends nothing.
 attempted=[];assert.equal(Date.parse(store.get('jobs','domain-watch-sweeper').next_run),later+21600000);
 await scheduler.tick(later+21600000);assert.deepEqual(attempted,[]);assert.equal(store.get('jobs','domain-watch-sweeper').last_outcome,'verified');
});

test('one RDAP outage never pauses the sweeper and a healthy domain keeps changing',async()=>{
 const {store,query}=setup(),at=Date.parse('2026-11-17T12:00:00Z');store.save('settings',{id:'installation',owner:store.device,timezone:'UTC',delivery:'notebook'});addDomainWatch(store,'up.example');addDomainWatch(store,'down.example');
 store.save('jobs',{id:'domain-watch-sweeper',next_run:new Date(at).toISOString()});
 let healthy=['active'],down=true;const scheduler=new Scheduler(store,{query,executor:job=>procedure(job,{store,query,fetcher:async url=>{if(String(url).includes('down.example')&&down)throw Error('offline');return rdap(String(url).includes('up.example')?healthy:['active']);}})});
 for(let run=0;run<5;run++){
  const slot=at+run*21600000;await scheduler.tick(slot);
  const job=store.get('jobs','domain-watch-sweeper');assert.equal(job.paused,false);assert.equal(job.state,'pending');assert.equal(job.retry_count,0);assert.equal(Date.parse(job.next_run),slot+21600000);
 }
 const failedRuns=store.list('job_receipts').filter(receipt=>receipt.job_id==='domain-watch-sweeper');assert.equal(failedRuns.length,5);assert.ok(failedRuns.every(receipt=>receipt.result.domains.some(domain=>domain.domain==='down.example'&&domain.ok===false&&domain.error==='offline')));
 healthy=['pendingDelete'];down=false;await scheduler.tick(at+5*21600000);
 assert.equal(store.get('jobs','domain-watch-sweeper').paused,false);assert.equal(store.get('jobs','domain-watch-sweeper').state,'pending');
 assert.equal(store.get('domain_watches','domain-'+hash('up.example').slice(0,24)).state,'pending delete');assert.equal(store.get('domain_watches','domain-'+hash('down.example').slice(0,24)).state,'registered');
 assert.equal(store.list('notifications').filter(note=>note.domain==='up.example').length,1);
});

test('chat authorizes adding, listing and removing a named domain',async()=>{
 const {store,query}=setup();let seen,answer={reply:'Done',language:'en',operations:[{type:'domain-watch-add',domain:'example.com',source_quote:'watch the domain example.com'}]};
 const domains=new Domains(query,{provider:async request=>{seen=request;return answer;}});
 await domains.invoke('conversation-chat',{conversation_id:'domain-chat',request_id:'add',message:'watch the domain example.com'});
 assert.deepEqual(listDomainWatches(store).map(w=>w.domain),['example.com']);
 answer={reply:'You are watching example.com.',language:'en'};
 const listed=await domains.invoke('conversation-chat',{conversation_id:'domain-chat',request_id:'list',message:'show my watched domains'});assert.match(listed.reply,/example.com/);assert.deepEqual(seen.context.domain_watches.map(w=>w.domain),['example.com']);
 answer={reply:'Done',language:'en',operations:[{type:'domain-watch-remove',domain:'example.com',source_quote:'stop watching example.com'}]};
 await domains.invoke('conversation-chat',{conversation_id:'domain-chat',request_id:'remove',message:'stop watching example.com'});
 assert.equal(listDomainWatches(store).length,0);
});

test('Settings operations add, list and remove a domain through the personal API',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-settings-')),service=await createService({root,port:0,webPort:0}),base='http://127.0.0.1:'+service.address.port;
 t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true,maxRetries:3});});
 const operation=value=>fetch(base+'/api/functions/personal-operation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 assert.equal((await operation({type:'domain-watch-add',domain:'Settings.Example'})).status,200);
 let state=await (await fetch(base+'/api/domain-watches')).json();assert.deepEqual(state.domains.map(w=>w.domain),['settings.example']);
 assert.equal((await operation({type:'domain-watch-remove',domain:'settings.example'})).status,200);
 state=await (await fetch(base+'/api/domain-watches')).json();assert.deepEqual(state.domains,[]);
});
