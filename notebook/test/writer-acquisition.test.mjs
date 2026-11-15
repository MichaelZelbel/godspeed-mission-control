import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {Store} from '../core/records/store.mjs';import {createService} from '../server/main.mjs';
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-writer-acquisition-'));
async function holdOtherWriter(workspace,ms=200){
 const child=spawn(process.execPath,['-e',"const fs=require('fs'),path=require('path'),file=path.join(process.argv[1],'.godspeed','workspace.lock');const fd=fs.openSync(file,'wx');fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);process.stdout.write('held');setTimeout(()=>{fs.unlinkSync(file)},Number(process.argv[2]));",workspace,String(ms)],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('Fictional writer failed: '+code)));});
 await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);child.stderr.once('data',data=>reject(Error(String(data))));});return {closed};
}
test('asynchronous acquisition waits for the actual other writer and saves once',async()=>{
 const store=new Store(root()),{closed}=await holdOtherWriter(store.root);
 const record=await store.saveAsync('notes',{id:'fictional-one-save',content:'Actual local test bytes'});await closed;
 assert.equal(record.revision,1);assert.equal(store.get('notes',record.id).content,'Actual local test bytes');
});
test('a callback failure after a durable change never replays the transaction',async()=>{
 const store=new Store(root());let attempts=0;
 await assert.rejects(store.withLockAsync(()=>{attempts++;store.commit([store.prepare('notes',{id:'fictional-uncertain-change',content:'Already retained'})]);throw Object.assign(Error('Fictional callback writer error'),{code:'WRITER_BUSY'});}),/Fictional callback writer error/);
 assert.equal(attempts,1);assert.equal(store.get('notes','fictional-uncertain-change').revision,1);
});
test('cancelling acquisition leaves no record and no replaced owner lock',async()=>{
 const store=new Store(root()),{closed}=await holdOtherWriter(store.root,250),controller=new AbortController();setTimeout(()=>controller.abort(),20);
 await assert.rejects(store.saveAsync('notes',{id:'fictional-cancelled'},undefined,{signal:controller.signal}),{name:'AbortError'});assert.equal(store.get('notes','fictional-cancelled'),undefined);assert.ok(fs.existsSync(path.join(store.state,'workspace.lock')));await closed;
});
test('normal chat API survives a real writer appearing after its initial wait, without duplicate input or reply',async()=>{
 let calls=0;const service=await createService({root:root(),port:0,provider:async input=>{if(input.kind==='retrieval-expansion')return {terms:[]};calls++;return JSON.stringify({reply:'Fictional source checked'});}}),base='http://127.0.0.1:'+service.address.port,original=service.store.waitForWriter.bind(service.store);let injected=false,other;
 service.store.waitForWriter=async options=>{await original(options);if(!injected){injected=true;other=await holdOtherWriter(service.store.root,200);}};
 const request={conversation_id:'notebook:fictional-contention',message:'What fictional fact is saved?',request_id:randomUUID()},post=()=>fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
 try{
  const response=await post();assert.equal(response.status,200);assert.equal((await response.json()).data.reply,'Fictional source checked');await other.closed;
  assert.equal((await post()).status,200);assert.equal(calls,1);
  assert.equal(service.store.list('conversation_messages').filter(m=>m.id==='chat-input-'+request.request_id).length,1);
  assert.equal(service.store.list('note_conversations')[0].state.messages.filter(m=>m.role==='assistant').length,1);
  assert.equal(service.store.get('command_receipts','chat-request-'+request.request_id).state,'verified');
 }finally{await service.close();}
});
test('a writer arriving after the response wait cannot lose the generated reply',async()=>{
 const service=await createService({root:root(),port:0,provider:async input=>input.kind==='retrieval-expansion'?{terms:[]}:JSON.stringify({reply:'Fictional checked reply retained'})}),original=service.store.waitForWriter.bind(service.store);let waits=0,other;
 service.store.waitForWriter=async options=>{await original(options);if(++waits===3)other=await holdOtherWriter(service.store.root,200);};
 try{
  const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversation_id:'notebook:fictional-late-writer',message:'What fictional detail?',request_id:randomUUID()})});
  assert.equal(response.status,200);assert.equal((await response.json()).data.reply,'Fictional checked reply retained');assert.ok(other);await other.closed;
  assert.equal(service.store.list('conversation_messages').filter(m=>m.role==='assistant').length,1);
 }finally{await service.close();}
});

test('a writer that is alive but not ours to signal reads as busy, and its lock stays',()=>{
 const store=new Store(root()),lock=path.join(store.state,'workspace.lock');fs.writeFileSync(lock,JSON.stringify({pid:424242}));
 const kill=process.kill;process.kill=()=>{throw Object.assign(Error('operation not permitted'),{code:'EPERM'});};
 try{assert.throws(()=>store.withLock(()=>{}),{code:'WRITER_BUSY'});}finally{process.kill=kill;}
 assert.ok(fs.existsSync(lock),'The other writer\'s lock is left alone');
});