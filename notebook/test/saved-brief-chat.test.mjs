import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const acceptedSentences=[
 'No fresh health observations are recorded.',
 'The fictional launch plan is ready for review.',
 'The first checklist covers the opening task.',
 'The second checklist covers the follow-up.',
 'The schedule keeps the fictional deadline visible.',
 'The notes name the next decision.',
 'The draft keeps the agreed scope.',
 'The review can happen in the notebook.',
 'Nothing in this fictional plan has been sent.',
 'Next: review the fictional launch plan.',
];
const saved=acceptedSentences.join('\n\n');
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

test('a complex create and repeat request preserves every accepted sentence in one canonical briefing',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-new-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 store.save('settings',{id:'installation',timezone:'UTC'});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const calls=[],provider=async input=>{calls.push(input.kind);return input.kind==='brief-verification'?{passed:true,reason:'Fictional briefing checked.'}:saved;};
 const domains=new Domains(query,{provider});
 const first=await domains.invoke('conversation-chat',{conversation_id:'notebook:first',request_id:'brief-first',message:"Please create today's morning briefing"});
 const again=await domains.invoke('conversation-chat',{conversation_id:'notebook:first',request_id:'brief-again',message:"Please repeat today's morning briefing"});
 const briefs=store.list('notes').filter(note=>note.source_app==='morning-brief');
 assert.equal(briefs.length,1);assert.equal(first.reply,briefs[0].content);assert.equal(again.reply,briefs[0].content);
 for(const sentence of acceptedSentences)assert.ok(briefs[0].content.includes(sentence),sentence);
 assert.ok(calls.includes('brief-verification'));assert.equal(calls.includes('conversation-chat'),false);
});

test('a hidden briefing keeps every chat surface silent without creating a replacement',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-hidden-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 const hidden=saveBrief(store);store.save('notes',{id:hidden.id,ai_visibility:'hidden'});let calls=0;
 const domains=new Domains(query,{provider:async()=>{calls++;return saved;}});
 for(const [name,input] of chatInputs(store))assert.equal((await domains.invoke(name,{...input,message:"today's brief"})).reply,'');
 assert.equal(calls,0);
 assert.deepEqual(store.list('notes').filter(note=>note.source_app==='morning-brief').map(note=>note.id),[hidden.id]);
});

test('concurrent first requests share one checked saved briefing',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-concurrent-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 store.save('settings',{id:'installation',timezone:'UTC'});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 let startedResolve,releaseResolve,writes=0;const started=new Promise(resolve=>{startedResolve=resolve;}),release=new Promise(resolve=>{releaseResolve=resolve;});
 const drafts=[saved,'Different accepted briefing.\n\nNext: a different step.'];
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional briefing checked.'};if(input.phase==='thin-repair')return drafts[0];const draft=drafts[writes++];startedResolve();await release;return draft;};
 const domains=new Domains(query,{provider}),first=domains.invoke('conversation-chat',{conversation_id:'notebook:first',request_id:'concurrent-one',message:"today's brief"});
 await started;
 const second=domains.invoke('conversation-chat',{conversation_id:'notebook:second',request_id:'concurrent-two',message:"today's brief"});
 await new Promise(resolve=>setImmediate(resolve));releaseResolve();
 const replies=await Promise.all([first,second]),briefs=store.list('notes').filter(note=>note.source_app==='morning-brief');
 const jobs=new Set(store.list('job_receipts').filter(receipt=>receipt.kind==='brief-verification').map(receipt=>receipt.job_id));
 assert.equal(jobs.size,1);assert.equal(briefs.length,1);assert.deepEqual(replies.map(result=>result.reply),[briefs[0].content,briefs[0].content]);
});

test('concurrent requests on adjacent local days create their own briefing',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-11-17T23:59:00Z')});
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-midnight-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 store.save('settings',{id:'installation',timezone:'UTC'});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const source=store.save('notes',{title:'Checked contribution',content:'Use this checked contribution.'});
 store.save('lead_entries',{title:'Checked contribution',content:source.content,note_id:source.id,status:'ready',delivery_day:'2026-11-17'});
 let startedResolve,releaseResolve,writes=0;const started=new Promise(resolve=>{startedResolve=resolve;}),release=new Promise(resolve=>{releaseResolve=resolve;});
 const draft='Adjacent-day briefing.\n\nNext: finish the current step.';
 const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional briefing checked.'};if(input.kind!=='morning-brief'||input.phase==='thin-repair')return draft;writes++;if(writes===1){startedResolve();await release;}return draft;};
 const domains=new Domains(query,{provider}),previous=domains.invoke('conversation-chat',{conversation_id:'notebook:previous',request_id:'midnight-previous',message:"today's brief"});
 await started;t.mock.timers.setTime(Date.parse('2026-11-18T00:01:00Z'));
 const currentRequest=domains.invoke('conversation-chat',{conversation_id:'notebook:current',request_id:'midnight-current',message:"today's brief"});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);
 releaseResolve();const [before,current]=await Promise.all([previous,currentRequest]),briefs=store.list('notes').filter(note=>note.source_app==='morning-brief');
 assert.ok(writes>=2);assert.deepEqual(new Set(briefs.map(note=>note.brief_day)),new Set(['2026-11-17','2026-11-18']));
 assert.equal(before.reply,briefs.find(note=>note.brief_day==='2026-11-17').content);assert.equal(current.reply,briefs.find(note=>note.brief_day==='2026-11-18').content);
});

test('a rejected creation releases its claim so the next request retries',async t=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-retry-brief-chat-'))),query=new QueryService(store);t.after(()=>fs.rmSync(store.root,{recursive:true,force:true}));
 store.save('settings',{id:'installation',timezone:'UTC'});store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 let attempts=0,fail=true;const provider=async input=>{if(input.kind==='brief-verification')return {passed:true,reason:'Fictional briefing checked.'};if(input.kind!=='morning-brief'||input.phase==='thin-repair')return saved;attempts++;if(fail)throw Error('Temporary briefing failure');return saved;};
 const domains=new Domains(query,{provider});
 await assert.rejects(domains.invoke('conversation-chat',{conversation_id:'notebook:retry',request_id:'retry-one',message:"today's brief"}),/Temporary briefing failure/);
 const failedAttempts=attempts;fail=false;
 const retried=await domains.invoke('conversation-chat',{conversation_id:'notebook:retry',request_id:'retry-two',message:"today's brief"}),briefs=store.list('notes').filter(note=>note.source_app==='morning-brief');
 assert.ok(attempts>failedAttempts);assert.equal(briefs.length,1);assert.equal(retried.reply,briefs[0].content);
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

test('saved record and both notebook chat endpoints agree after complex creation and repeat',async t=>{
 const calls=[],root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-endpoints-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const provider=async input=>{calls.push(input.kind);return input.kind==='brief-verification'?{passed:true,reason:'Fictional briefing checked.'}:saved;};
 const service=await createService({root,port:0,provider}),base='http://127.0.0.1:'+service.address.port;t.after(()=>service.close());
 service.store.save('settings',{id:'installation',timezone:'UTC'});service.store.save('goals',{title:'Prepare a fictional guide',status:'adopted'});
 const post=async(route,body)=>{const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();};
 const standard=await post('/api/functions/conversation-chat',{conversation_id:'notebook:panel',message:"Please prepare today's morning briefing",request_id:'01234567-1234-4234-8234-012345678901'});
 const browser=await post('/api/browser-chat',{message:"Please repeat today's morning briefing",request_id:'01234567-1234-4234-8234-012345678902'});
 const briefs=service.query.rows('notes').filter(note=>note.source_app==='morning-brief');assert.equal(briefs.length,1);
 assert.equal(standard.data.reply,briefs[0].content);assert.equal(browser.reply,briefs[0].content);
 for(const sentence of acceptedSentences)assert.ok(briefs[0].content.includes(sentence),sentence);
 assert.ok(calls.includes('brief-verification'));assert.equal(calls.includes('conversation-chat'),false);
 assert.equal(service.query.rows('conversation_messages').filter(message=>message.role==='assistant'&&message.content===saved).length,2);
});
