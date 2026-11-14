import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {createService} from '../server/main.mjs';
import {Telegram} from '../core/telegram.mjs';

const saved='Saved filtered briefing.\n\nNext: exact allowed next step.\n\nCharm Challenge: exact line.';
const day=()=>new Date().toISOString().slice(0,10);
const saveBrief=store=>store.save('notes',{title:'Your morning briefing',content:saved,source_app:'morning-brief',brief_day:day()});

test('saved brief requests bypass provider and native agents word for word',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 store.save('notes',{title:'Briefing source',content:'FILTERED OUT SENTENCE'});saveBrief(store);
 let providerCalls=0,nativeCalls=0;
 const providerDomains=new Domains(query,{provider:async()=>{providerCalls++;return {reply:'Provider substitute'};}});
 const nativeDomains=new Domains(query,{provider:async()=>({reply:'unused'})});nativeDomains.nativeAgent=async()=>{nativeCalls++;return {reply:'Native substitute'};};
 assert.equal((await providerDomains.invoke('conversation-chat',{conversation_id:'notebook:provider',message:"Please show me today's brief."})).reply,saved);
 assert.equal((await nativeDomains.invoke('conversation-chat',{conversation_id:'notebook:native',message:'Zeig mir das heutige Briefing, bitte.'})).reply,saved);
 assert.equal((await providerDomains.invoke('conversation-chat',{conversation_id:'notebook:bare',message:'brief'})).reply,saved);
 assert.equal(providerCalls,0);assert.equal(nativeCalls,0);
 assert.equal(store.list('notes').filter(note=>note.source_app==='morning-brief').length,1);
 assert.equal(saved.includes('FILTERED OUT SENTENCE'),false);
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
