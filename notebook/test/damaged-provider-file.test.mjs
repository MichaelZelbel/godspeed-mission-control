// #805: a .godspeed/provider.json that was not valid JSON stopped the notebook at startup, and a
// supervisor restarted it into the same stop. Now the notebook starts with no AI connected, Settings
// reads the saved connection as one that cannot be read, and the file stays where it was.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

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
