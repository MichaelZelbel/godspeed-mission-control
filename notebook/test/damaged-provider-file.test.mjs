// #805: a .godspeed/provider.json that was not valid JSON stopped the notebook at startup, and a
// supervisor restarted it into the same stop. Now the notebook starts with no AI connected, Settings
// reads the saved connection as one that cannot be read, and the file stays where it was.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {nativeAgent,NO_MODEL_IN_HOME} from '../core/native-agent.mjs';

const damaged={
 'not JSON':'{"url":"https://openrouter.ai/api/v1/chat/completions","key":"fictional-ke',
 'JSON without the expected fields':'["fictional"]',
 'an address the notebook refuses':JSON.stringify({url:'http://example.invalid/v1/chat/completions',key:'fictional-key',model:'fictional-model'}),
};

for(const [kind,text] of Object.entries(damaged))test(`a saved AI connection that is ${kind} leaves the notebook running with no AI connected`,async t=>{
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-damaged-provider-'));for(const name of names)delete process.env[name];process.env.GODSPEED_ASSISTANT_CONFIG=path.join(root,'none.json');
 const workspace=path.join(root,'workspace'),file=path.join(workspace,'.godspeed','provider.json');
 fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
 const {createService}=await import('../server/main.mjs');const service=await createService({root:workspace,port:0});
 t.after(async()=>{await service.close();for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port,read=async route=>{const response=await fetch(base+route);return {status:response.status,body:await response.json()};};

 const health=await read('/health');assert.equal(health.status,200);assert.equal(health.body.ok,true);
 const status=await read('/api/status');assert.equal(status.body.aiConfigured,false);assert.equal(status.body.aiAvailability,'none');
 assert.equal((await read('/api/chat/options')).body.connected,false);
 // Settings, Your AI, shows "The saved AI connection could not be read ... Remove it to connect one again" on this error.
 const provider=await read('/api/provider');assert.ok(provider.status>=400,'the saved connection was read as '+JSON.stringify(provider.body));assert.equal(typeof provider.body.error,'string');
 assert.equal(fs.readFileSync(file,'utf8'),text);
});

// The assistant's chat reads the same file: one that cannot be read is no saved connection, so the
// chat asks the assistant instead of saying an AI connected in Settings was not set up for it.
for(const [kind,text] of Object.entries(damaged))test(`the assistant's chat treats a saved AI connection that is ${kind} as none`,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-damaged-provider-chat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const home=path.join(dir,'home'),providerFile=path.join(dir,'provider.json');fs.mkdirSync(home);fs.writeFileSync(providerFile,text);
 const asked=[],spawnProcess=(executable,args)=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin.on('data',()=>queueMicrotask(()=>{asked.push(args);child.stdout.write('Answered.');child.emit('close',0);}));return child;};
 const ask=nativeAgent({executable:'hermes',home,cwd:dir,providerFile,spawnProcess});
 const answer=await ask({message:'Hello',conversation_id:'browser-owner'}).catch(error=>error);
 assert.notEqual(answer.message,NO_MODEL_IN_HOME);assert.deepEqual(answer,{reply:'Answered.'});
 assert.equal(asked.length,1);assert.equal(asked[0].includes('--provider'),false);
 assert.equal(fs.readFileSync(providerFile,'utf8'),text);
});

// With the original runtime, a chat never says the AI is "connected only to the notebook" because of a
// file that Settings cannot read: that sentence points at a box that file cannot tick.
for(const [kind,text] of Object.entries(damaged))test(`a chat with the original runtime does not claim a saved AI connection that is ${kind}`,async t=>{
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-damaged-provider-runtime-')),workspace=path.join(dir,'workspace'),home=path.join(dir,'hermes-home'),assistant=path.join(dir,'assistant.json');
 for(const name of names)delete process.env[name];
 fs.mkdirSync(home,{recursive:true});fs.writeFileSync(assistant,JSON.stringify({verified:true,executable:path.join(dir,'missing','hermes'),home}));
 process.env.GODSPEED_ORIGINAL_RUNTIME='on';process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 const file=path.join(workspace,'.godspeed','provider.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);
 const {createService}=await import('../server/main.mjs');const service=await createService({root:workspace,port:0});
 t.after(async()=>{await service.close();for(const name of names)if(saved[name]===undefined)delete process.env[name];else process.env[name]=saved[name];fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port;
 const options=await (await fetch(base+'/api/chat/options')).json();assert.notEqual(options.availability,'settings-only');
 const reply=await fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:crypto.randomUUID(),message:'Hello'})}),answer=await reply.json();
 assert.equal(typeof answer.error,'string');assert.doesNotMatch(answer.error,/connected only to the notebook|connected in Settings/);
 assert.equal(fs.readFileSync(file,'utf8'),text);
});
