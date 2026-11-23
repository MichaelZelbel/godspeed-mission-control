import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NOTEBOOK_CHAT_FUNCTIONS} from '../core/notebook-chat.mjs';
import {createService} from '../server/main.mjs';
import {Telegram} from '../core/telegram.mjs';

const CHAT_SURFACES=['conversation-chat','note-chat','collection-chat'];
assert.deepEqual(new Set(CHAT_SURFACES),new Set(NOTEBOOK_CHAT_FUNCTIONS),'saved brief cases must cover every notebook chat surface');

const saved='Saved filtered briefing.\n\nNext: exact allowed next step.\n\nCharm Challenge: exact line.';
const savedWithoutChallenge='Saved filtered briefing.\n\nNext: exact allowed next step.';
const day=()=>new Date().toISOString().slice(0,10);
const saveBrief=(store,content=saved)=>store.save('notes',{title:'Your morning briefing',content,source_app:'morning-brief',brief_day:day()});
const chatInputs=store=>{
 const note=store.save('notes',{title:'Current note',content:'Current note content'});
 const collection=store.save('collections',{name:'Current collection',field_schema:[{key:'name',label:'Name',type:'text',primary:true}]});
 const inputByName={
  'conversation-chat':{conversation_id:'notebook:conversation'},
  'note-chat':{note_id:note.id},
  'collection-chat':{collection_id:collection.id},
 };
 return CHAT_SURFACES.map(name=>[name,inputByName[name]]);
};

test('saved brief requests bypass provider and native agents word for word',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 store.save('notes',{title:'Briefing source',content:'FILTERED OUT SENTENCE'});saveBrief(store);
 let providerCalls=0,nativeCalls=0;
 const providerDomains=new Domains(query,{provider:async()=>{providerCalls++;return {reply:'Provider substitute'};}});
 const nativeDomains=new Domains(query,{provider:async()=>({reply:'unused'})});nativeDomains.nativeAgent=async()=>{nativeCalls++;return {reply:'Native substitute'};};
 for(const [name,input] of chatInputs(store))assert.equal((await providerDomains.invoke(name,{...input,message:"Please show me today's brief."})).reply,saved);
 assert.equal((await nativeDomains.invoke('conversation-chat',{conversation_id:'notebook:native',message:'Zeig mir das heutige Briefing, bitte.'})).reply,saved);
 assert.equal((await providerDomains.invoke('conversation-chat',{conversation_id:'notebook:bare',message:'brief'})).reply,saved);
 assert.equal((await providerDomains.invoke('conversation-chat',{conversation_id:'notebook:saved',message:'show my saved morning brief again'})).reply,saved);
 assert.equal((await providerDomains.invoke('conversation-chat',{conversation_id:'notebook:unicode',message:'😀'.repeat(59)+'brief'})).reply,saved);
 assert.equal(providerCalls,0);assert.equal(nativeCalls,0);
 assert.equal(store.list('notes').filter(note=>note.source_app==='morning-brief').length,1);
 assert.equal(saved.includes('FILTERED OUT SENTENCE'),false);
});

test('all chat surfaces preserve a saved brief without adding a Charm Challenge',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-no-challenge-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 saveBrief(store,savedWithoutChallenge);let calls=0;
 const domains=new Domains(query,{provider:async()=>{calls++;return {reply:'Substitute with a Charm Challenge'};}});
 for(const [name,input] of chatInputs(store))assert.equal((await domains.invoke(name,{...input,message:"today's brief"})).reply,savedWithoutChallenge);
 assert.equal(calls,0);
});

test('a brief request without a saved briefing keeps ordinary chat behavior',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-new-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const calls=[],provider=async input=>{calls.push(input.kind);return {reply:'The ordinary chat answer'};};
 const domains=new Domains(query,{provider});
 for(const [name,input] of chatInputs(store)){
  const result=await domains.invoke(name,{...input,request_id:'brief-first-'+name,message:"today's brief"});
  assert.equal(result.reply,'The ordinary chat answer');
 }
 assert.equal(store.list('notes').filter(note=>note.source_app==='morning-brief').length,0);
 assert.deepEqual(calls,CHAT_SURFACES);
});

test('candidate Telegram reports a definitely incomplete long saved brief',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-telegram-partial-')),store=new Store(root),query=new QueryService(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const longSaved='Saved filtered briefing.\n\n'+'.'.repeat(4000)+'\n\nCharm Challenge: exact final line.';
 store.save('notes',{title:'Your morning briefing',content:longSaved,source_app:'morning-brief',brief_day:day()});
 const attempted=[],accepted=[],updates=[{update_id:2,message:{from:{id:42,is_bot:false,language_code:'en'},chat:{id:42,type:'private'},text:'brief'}}];
 const transport=async(url,init)=>{const method=url.split('/').at(-1),body=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:updates.splice(0)}));attempted.push(body.text);if(attempted.length===2)return new Response(JSON.stringify({ok:false,error_code:400}),{status:400});accepted.push(body.text);return new Response(JSON.stringify({ok:true,result:{message_id:attempted.length}}));};
 await new Telegram({store,domains:new Domains(query,{provider:async()=>({reply:'Substitute'})}),token:'TEST',owner:'42',transport}).tick();
 assert.equal(attempted.length,3);assert.equal(accepted.length,2);assert.equal(accepted[0],longSaved.slice(0,4000));
 assert.equal(accepted[1],'Your reply was only partly delivered. Please send your message again.');
 assert.equal(store.get('command_receipts','telegram-2').state,'needs_review');
 assert.equal(store.get('command_receipts','telegram-2-failure-notice').state,'verified');
});

test('candidate Telegram reports a malformed definite rejection after one part',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-telegram-malformed-')),store=new Store(root),query=new QueryService(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const longSaved='Saved filtered briefing. '+'.'.repeat(4000);store.save('notes',{title:'Your morning briefing',content:longSaved,source_app:'morning-brief',brief_day:day()});
 const attempted=[],updates=[{update_id:3,message:{from:{id:42,is_bot:false},chat:{id:42,type:'private'},text:'brief'}}];
 const transport=async(url,init)=>{const method=url.split('/').at(-1),body=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:updates.splice(0)}));attempted.push(body.text);if(attempted.length===2)return new Response('not json',{status:400});return new Response(JSON.stringify({ok:true,result:{message_id:attempted.length}}));};
 await new Telegram({store,domains:new Domains(query),token:'TEST',owner:'42',transport}).tick();
 assert.deepEqual(attempted.slice(0,2).map(text=>text.length),[4000,25]);assert.equal(attempted.length,3);
 assert.equal(attempted.at(-1),'Your reply was only partly delivered. Please send your message again.');
 assert.equal(store.get('command_receipts','telegram-3-failure-notice').state,'verified');
});

test('candidate Telegram does not follow an uncertain server failure with another send',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-telegram-server-')),store=new Store(root),query=new QueryService(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const longSaved='Saved filtered briefing. '+'.'.repeat(4000);store.save('notes',{title:'Your morning briefing',content:longSaved,source_app:'morning-brief',brief_day:day()});
 const attempted=[],updates=[{update_id:4,message:{from:{id:42,is_bot:false},chat:{id:42,type:'private'},text:'brief'}}];
 const transport=async(url,init)=>{const method=url.split('/').at(-1),body=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:updates.splice(0)}));attempted.push(body.text);if(attempted.length===2)return new Response(JSON.stringify({ok:false,error_code:500}),{status:500});return new Response(JSON.stringify({ok:true,result:{message_id:attempted.length}}));};
 await new Telegram({store,domains:new Domains(query),token:'TEST',owner:'42',transport}).tick();
 assert.deepEqual(attempted.map(text=>text.length),[4000,25]);
 assert.equal(store.get('command_receipts','telegram-4-failure-notice'),undefined);
});

test('candidate Telegram does not follow a malformed server failure with another send',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-telegram-malformed-server-')),store=new Store(root),query=new QueryService(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const longSaved='Saved filtered briefing. '+'.'.repeat(4000);store.save('notes',{title:'Your morning briefing',content:longSaved,source_app:'morning-brief',brief_day:day()});
 const attempted=[],updates=[{update_id:6,message:{from:{id:42,is_bot:false},chat:{id:42,type:'private'},text:'brief'}}];
 const transport=async(url,init)=>{const method=url.split('/').at(-1),body=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:updates.splice(0)}));attempted.push(body.text);if(attempted.length===2)return new Response('not json',{status:500});return new Response(JSON.stringify({ok:true,result:{message_id:attempted.length}}));};
 await new Telegram({store,domains:new Domains(query),token:'TEST',owner:'42',transport}).tick();
 assert.deepEqual(attempted.map(text=>text.length),[4000,25]);
 assert.equal(store.get('command_receipts','telegram-6-failure-notice'),undefined);
});

test('candidate Telegram gives ordinary partial replies neutral recovery guidance',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-telegram-partial-')),store=new Store(root),query=new QueryService(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const attempted=[],updates=[{update_id:5,message:{from:{id:42,is_bot:false},chat:{id:42,type:'private'},text:'Explain my project'}}];
 const transport=async(url,init)=>{const method=url.split('/').at(-1),body=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:updates.splice(0)}));attempted.push(body.text);if(attempted.length===2)return new Response(JSON.stringify({ok:false,error_code:400}),{status:400});return new Response(JSON.stringify({ok:true,result:{message_id:attempted.length}}));};
 const domains=new Domains(query,{provider:async()=>({reply:'x'.repeat(8001)})});
 await new Telegram({store,domains,token:'TEST',owner:'42',transport}).tick();
 assert.deepEqual(attempted.slice(0,2).map(text=>text.length),[4000,4000]);assert.equal(attempted.length,3);
 assert.equal(attempted.at(-1),'Your reply was only partly delivered. Please send your message again.');
});

test('candidate Telegram delivers a long saved brief in full',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-telegram-')),store=new Store(root),query=new QueryService(store);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const longSaved='Saved filtered briefing.\n\n'+'.'.repeat(4000)+'\n\nCharm Challenge: exact final line.';
 store.save('notes',{title:'Your morning briefing',content:longSaved,source_app:'morning-brief',brief_day:day()});
 const sent=[],updates=[{update_id:1,message:{from:{id:42,is_bot:false,language_code:'en'},chat:{id:42,type:'private'},text:'brief'}}];
 const transport=async(url,init)=>{const method=url.split('/').at(-1),body=JSON.parse(init.body);if(method==='getUpdates')return new Response(JSON.stringify({ok:true,result:updates.splice(0)}));sent.push(body.text);return new Response(JSON.stringify({ok:true,result:{message_id:sent.length}}));};
 await new Telegram({store,domains:new Domains(query,{provider:async()=>({reply:'Substitute'})}),token:'TEST',owner:'42',transport}).tick();
 assert.equal(sent.length,2);assert.equal(sent.join(''),longSaved);assert.match(sent.at(-1),/Charm Challenge: exact final line\.$/);
});

test('both notebook chat endpoints return the same saved brief',async t=>{
 let calls=0;const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-endpoints-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const service=await createService({root,port:0,provider:async()=>{calls++;return {reply:'Substitute'};}}),base='http://127.0.0.1:'+service.address.port;t.after(()=>service.close());saveBrief(service.store);
 const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const standard=await post('/api/functions/conversation-chat',{conversation_id:'notebook:panel',message:"today's brief",request_id:'01234567-1234-4234-8234-012345678901'});
 const browser=await post('/api/browser-chat',{message:'mein Morgenbriefing',request_id:'01234567-1234-4234-8234-012345678902'});
 assert.equal(standard.data.reply,saved);assert.equal(browser.reply,saved);assert.equal(calls,0);
 assert.equal(service.query.rows('conversation_messages').filter(message=>message.role==='assistant'&&message.content===saved).length,2);
});

test('with the AI connected only to the notebook, the chat asked twice shows the saved brief word for word (#1039)',async t=>{
 let aiRequests=0;
 const endpoint=http.createServer(async(req,res)=>{for await(const chunk of req);aiRequests++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({choices:[{message:{content:'Connected.'}}]}));});
 await new Promise(resolve=>endpoint.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>endpoint.close(resolve)));
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],env=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-settings-only-')),home=path.join(dir,'hermes-home'),assistant=path.join(dir,'assistant.json');
 for(const n of names)delete process.env[n];
 fs.mkdirSync(home,{recursive:true});fs.writeFileSync(assistant,JSON.stringify({verified:true,executable:'hermes',home}));process.env.GODSPEED_ORIGINAL_RUNTIME='on';process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 const service=await createService({root:path.join(dir,'workspace'),port:0});
 t.after(async()=>{await service.close();for(const n of names)if(env[n]===undefined)delete process.env[n];else process.env[n]=env[n];fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+service.address.port,json={'Content-Type':'application/json'};
 const connected=await fetch(origin+'/api/provider',{method:'POST',headers:json,body:JSON.stringify({url:'http://127.0.0.1:'+endpoint.address().port,key:'fictional-key',model:'fictional-model',routines:false})});
 assert.equal(connected.status,200);
 const ask=async message=>{const response=await fetch(origin+'/api/functions/conversation-chat',{method:'POST',headers:json,body:JSON.stringify({request_id:crypto.randomUUID(),conversation_id:'notebook:settings-only',message})});return [response,await response.json()];};
 const [none,noneBody]=await ask("today's brief");
 assert.equal(none.status,400);assert.match(noneBody.error,/connected only to the notebook/);
 service.store.save('notes',{title:'Source',content:'REFUSED-1039 sentence from the source.'});
 const content='Grounded 1039 briefing.\n\nNext: Work on the saved 1039 goal today.';saveBrief(service.store,content);
 const before=aiRequests;
 for(const message of ["today's brief",'my brief again']){
  const [response,body]=await ask(message);
  assert.equal(response.status,200);assert.equal(body.data.reply,content);assert.doesNotMatch(body.data.reply,/REFUSED-1039/);
 }
 const panel=await fetch(origin+'/api/functions/conversation-chat',{method:'POST',headers:json,body:JSON.stringify({request_id:crypto.randomUUID(),conversation_id:'notebook:settings-only-panel',messages:[{role:'user',content:"today's brief"}]})});
 assert.equal(panel.status,200);assert.equal((await panel.json()).data.reply,content);
 assert.equal(aiRequests,before);
 assert.equal(service.query.rows('notes').filter(note=>note.source_app==='morning-brief').length,1);
});
