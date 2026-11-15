import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {ApiKeys} from '../core/api-keys.mjs';
import {mcp} from '../server/mcp.mjs';import {createService} from '../server/main.mjs';

// A key the owner gives another program acts within its scopes and never as the
// owner. Until 7 October 2026 a key limited to "actions" could, in the original
// runtime every installer ships, file a work item whose check was a shell
// command, run it with `work verify`, and write "approved" on an outward item in
// the owner's name. The installation's own assistant keeps those commands.
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-delegated-'));
const work=(context,args,delegated)=>mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'personal_operation',arguments:{type:'card-command',card:'work',args}}},{...context,scopes:['actions'],delegated}).then(r=>({error:!!r.result.isError,text:r.result.content[0].text}));

test('a delegated key cannot plant or run a work check, lease work or approve; the installation assistant still can',async t=>{
 const root=temporary();t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'rules'));fs.mkdirSync(path.join(root,'work'));
 const previous=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';
 t.after(()=>{if(previous===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=previous;});
 const store=new Store(root,{device:'fixture'}),query=new QueryService(store),context={store,query,domains:new Domains(query)};
 const proof=path.join(root,'proof.txt'),check='echo ran > proof.txt';
 for(const args of [
  ['file','--what','Fictional planted check','--done-when','proof exists','--check',check,'--id','W-FIXTURE-1'],
  ['verify','W-FIXTURE-1'],
  ['take','W-FIXTURE-1','--runner','another-program'],
  ['unblock','W-FIXTURE-1','--why','Fictional reason','--approved-by-him','yes, post it'],
  ['file','--what','Fictional approved task','--done-when','proof exists','--approved-by','yes','--id','W-FIXTURE-1'],
 ]){
  const refused=await work(context,args,true);
  assert.equal(refused.error,true,args.join(' '));assert.match(refused.text,/stay with the owner/,args.join(' '));
 }
 assert.equal(fs.existsSync(path.join(root,'work','W-FIXTURE-1.md')),false,'nothing was filed');
 assert.equal(fs.existsSync(proof),false,'nothing ran');
 // Reading and filing still work for the key.
 assert.equal((await work(context,['file','--what','Fictional filed task','--done-when','proof exists','--id','W-FIXTURE-2'],true)).error,false);
 assert.equal(fs.existsSync(path.join(root,'work','W-FIXTURE-2.md')),true);
 assert.equal((await work(context,['list'],true)).error,false);
 // The installation's own assistant keeps the original commands.
 assert.equal((await work(context,['file','--what','Fictional checked task','--done-when','proof exists','--check',check,'--id','W-FIXTURE-3'],false)).error,false);
 const verified=await work(context,['verify','W-FIXTURE-3'],false);
 assert.equal(verified.error,false,verified.text);assert.match(verified.text,/verified/);
 assert.equal(fs.readFileSync(proof,'utf8').trim(),'ran');
});

test('a delegated key cannot give a radar verdict or allow a change; the server tells it from the assistant key',async t=>{
 const root=temporary(),service=await createService({root,port:0});t.after(async()=>{await service.close();fs.rmSync(root,{recursive:true,force:true});});
 const keys=new ApiKeys(service.store),scopes=['notes','contacts','world','collections','media','profile','actions','stats'];
 const given=keys.invoke('mc-api-keys/generate',{name:'Another program',scopes}).api_key,own=keys.invoke('mc-api-keys/generate',{name:'Candidate assistant',scopes}).api_key;
 fs.writeFileSync(path.join(service.store.state,'assistant-mcp.json'),JSON.stringify({key:own}));
 const call=async(key,args)=>{const r=await fetch('http://127.0.0.1:'+service.address.port+'/mcp',{method:'POST',headers:{Authorization:'Bearer '+key},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'personal_operation',arguments:{type:'radar-command',args}}})});assert.equal(r.status,200);return (await r.json()).result.content[0].text;};
 for(const args of [['verdict','fictional-proposal','{"verdict":"Adopt","reason":"Fictional reason"}'],['allow','fictional-proposal','{"draft_id":"fictional"}']])assert.match(await call(given,args),/stay with the owner/,args[0]);
 // The assistant's own key passes that rule, and is then told what is really missing.
 assert.match(await call(own,['verdict','fictional-proposal','{"verdict":"Adopt","reason":"Fictional reason"}']),/radar proposal/);
 assert.doesNotMatch(await call(own,['verdict','fictional-proposal','{"verdict":"Adopt","reason":"Fictional reason"}']),/stay with the owner/);
});
