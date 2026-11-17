import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {procedure} from '../core/procedures.mjs';
import {addDomainWatch,listDomainWatches,removeDomainWatch} from '../core/domain-watch.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';

const setup=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-domain-watch-'))),query=new QueryService(store);return {store,query};};
const rdap=status=>new Response(JSON.stringify({status}),{status:200,headers:{'Content-Type':'application/rdap+json'}});

test('domain watch records each successful state and notices each transition once',async()=>{
 const {store,query}=setup();addDomainWatch(store,' Example.COM. ');let state=['active'],calls=[];
 const fetcher=async(url,init)=>{calls.push({url:String(url),headers:init.headers});return rdap(state);};
 await procedure({kind:'domain-watch'},{store,query,fetcher});
 state=['pendingDelete'];await procedure({kind:'domain-watch'},{store,query,fetcher});await procedure({kind:'domain-watch'},{store,query,fetcher});
 state=null;const available=async(url,init)=>{calls.push({url:String(url),headers:init.headers});return new Response(null,{status:404});};
 await procedure({kind:'domain-watch'},{store,query,fetcher:available});
 assert.deepEqual(store.list('domain_watch_observations').sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(o=>o.state),['registered','pending delete','pending delete','available']);
 const notices=store.list('notifications');assert.equal(notices.length,2);assert.ok(notices.some(n=>/released in about five days/.test(n.body)));assert.ok(notices.some(n=>/registered now, at any registrar/.test(n.body)));
 assert.ok(calls.every(c=>c.url==='https://rdap.verisign.com/com/v1/domain/example.com'));
 assert.equal(calls[0].headers.Accept,'application/rdap+json');assert.match(calls[0].headers['User-Agent'],/Godspeed/);
});

test('RDAP fallback and total failure preserve the latest successful state',async()=>{
 const {store,query}=setup();addDomainWatch(store,'wanted.org');let called=[];
 await procedure({kind:'domain-watch'},{store,query,fetcher:async url=>{called.push(String(url));if(called.length===1)throw Error('offline');return rdap(['redemptionPeriod']);}});
 assert.deepEqual(called,['https://rdap.org/domain/wanted.org','https://www.rdap.net/domain/wanted.org']);
 const before=store.list('domain_watch_observations').length,result=await procedure({kind:'domain-watch'},{store,query,fetcher:async()=>{throw Error('offline');}});
 assert.equal(result.domains[0].ok,false);assert.equal(store.list('domain_watch_observations').length,before);assert.equal(store.list('domain_watches')[0].state,'redemption');assert.equal(store.list('notifications').length,0);
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
