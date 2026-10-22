import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync,spawn} from 'node:child_process';
import {addonModel,modelInput,modelConnection} from '../core/addon-model.mjs';
import {installModelCommand} from '../scripts/install-model-command.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-addons-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const state=path.join(root,'.godspeed'),runtime=path.join(root,'runtime'),home=path.join(state,'current-assistant');fs.mkdirSync(state,{recursive:true});fs.mkdirSync(runtime);fs.mkdirSync(home);
 const executable=path.join(runtime,'hermes'),python=path.join(runtime,'python3');fs.writeFileSync(executable,'');fs.writeFileSync(python,'');
 fs.writeFileSync(path.join(state,'assistant.json'),JSON.stringify({verified:true,executable,home,sourceRoot:runtime}));
 return {root,state,home,runtime};
}
const input={system:'Evaluate only this fictional profile.',prompt:'Invented person who likes sailing.'};
test('the packaged server runtime uses its own virtual environment and source root',t=>{
 const f=fixture(t),bin=path.join(f.runtime,'bin'),venv=path.join(f.runtime,'.venv','bin');fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(venv,{recursive:true});fs.writeFileSync(path.join(venv,'python3'),'');
 fs.writeFileSync(path.join(f.state,'assistant.json'),JSON.stringify({verified:true,home:f.home,executable:path.join(bin,'hermes')}));const connection=modelConnection(f.root);assert.equal(connection.python,path.join(venv,'python3'));assert.equal(connection.sourceRoot,f.runtime);
});
function fakeSpawn(reply,{code=0,delay=0,onSpawn=()=>{}}={}){
 return (executable,args,options)=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let bytes='';child.stdin.on('data',chunk=>bytes+=chunk);
  child.stdin.on('finish',()=>{onSpawn({executable,args,options,input:JSON.parse(bytes)});setTimeout(()=>{child.stdout.write(JSON.stringify(reply));child.stderr.write('private diagnostic should never be retained');child.emit('close',code);},delay);});return child;
 };
}
test('inherited model uses verified current assistant instead of notebook API key and returns only route metadata',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.state,'provider.json'),JSON.stringify({url:'https://unselected.example',model:'wrong',key:'never-copy-this'}));let called;
 const result=await addonModel({root:f.root,input,spawnProcess:fakeSpawn({text:'{"verdict":"like"}',provider:'configured-host',model:'selected-one'},{onSpawn:c=>called=c})});
 assert.equal(called.options.env.HERMES_HOME,f.home);assert.equal(called.options.cwd,f.runtime);assert.deepEqual(called.input,{...input,timeout_ms:120000,max_tokens:2048});assert.ok(called.args[0].endsWith('addon-model.py'));
 assert.deepEqual(result,{text:'{"verdict":"like"}',provider:'configured-host',model:'selected-one'});
 const receipt=fs.readFileSync(path.join(f.state,'model-requests.jsonl'),'utf8');for(const privateText of ['never-copy-this','Invented person','verdict','private diagnostic'])assert.ok(!receipt.includes(privateText));
});
test('connection check describes configuration without sending prompt or taking a model lock',async t=>{
 const f=fixture(t);let called;
 assert.deepEqual(await addonModel({root:f.root,describe:true,spawnProcess:fakeSpawn({configured:true,provider:'local',model:'chosen'},{onSpawn:c=>called=c})}),{configured:true,provider:'local',model:'chosen'});
 assert.deepEqual(called.input,{describe:true});assert.ok(!fs.existsSync(path.join(f.state,'model-request.lock')));assert.ok(!fs.existsSync(path.join(f.state,'model-requests.jsonl')));
});
test('failed host model does not fall through to an available notebook connection or return private diagnostics',async t=>{
 const f=fixture(t);let calls=0;fs.writeFileSync(path.join(f.state,'provider.json'),JSON.stringify({url:'https://unselected.example',key:'secret',model:'paid-fallback'}));
 await assert.rejects(addonModel({root:f.root,input,spawnProcess:fakeSpawn({error:'raw secret quota diagnostic'},{code:1,onSpawn:()=>calls++})}),/selected Godspeed model could not answer/);assert.equal(calls,1);assert.ok(!fs.existsSync(path.join(f.state,'model-request.lock')));
 assert.ok(!fs.readFileSync(path.join(f.state,'model-requests.jsonl'),'utf8').includes('secret'));
});
test('unverified assistant and malformed requests fail before model execution',async t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.state,'assistant.json'),JSON.stringify({verified:false,home:f.home,executable:'hermes'}));
 await assert.rejects(addonModel({root:f.root,input}),/Connect the Godspeed assistant/);
 for(const value of [{...input,provider:'other'},{...input,model:'other'}, {...input,timeout_ms:900000}, {...input,max_tokens:1},{...input,prompt:'x'.repeat(260000)}])assert.throws(()=>modelInput(value));
});
test('simultaneous add-ons share one bounded host execution slot',async t=>{
 const f=fixture(t);let active=0,peak=0;
 const spawn=fakeSpawn({text:'ok',provider:'host',model:'main'},{delay:70,onSpawn:()=>{active++;peak=Math.max(active,peak);setTimeout(()=>active--,65);}});
 await Promise.all([addonModel({root:f.root,input,spawnProcess:spawn}),addonModel({root:f.root,input,spawnProcess:spawn})]);assert.equal(peak,1);
});
test('API-only Godspeed keeps credentials inside host, has no tools, and respects its selected model',async t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.state,'assistant.json'));let request,authorization;
 const server=http.createServer(async(req,res)=>{authorization=req.headers.authorization;let bytes='';for await(const chunk of req)bytes+=chunk;request=JSON.parse(bytes);res.end(JSON.stringify({choices:[{message:{content:'a checked answer'}}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 fs.writeFileSync(path.join(f.state,'provider.json'),JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'host-only-key',model:'owner-choice'}));
 const result=await addonModel({root:f.root,input});assert.equal(result.model,'owner-choice');assert.equal(authorization,'Bearer host-only-key');assert.equal(request.model,'owner-choice');assert.equal(request.tools,undefined);assert.ok(!JSON.stringify(result).includes('key'));
});
test('fresh installation exposes a stable workspace launcher plus shell and Windows command forms',t=>{
 const f=fixture(t),out=installModelCommand({root:f.root,home:f.home,platform:'win32'});
 assert.ok(fs.readFileSync(out.launcher,'utf8').includes('notebook/bin/godspeed-model.mjs'));
 for(const file of [out.command,out.command+'.cmd']){const text=fs.readFileSync(file,'utf8');assert.ok(text.includes('GODSPEED_MODEL_WORKSPACE'));assert.ok(!text.includes('--workspace'));assert.ok(text.includes('model.mjs'));assert.ok(!text.includes('API_KEY'));}
 const wiring=fs.readFileSync(new URL('../scripts/wire-assistant.mjs',import.meta.url),'utf8');assert.match(wiring,/installModelCommand\(\{root,home\}\)/);
});
test('an installed wrapper honors an explicit different workspace and rejects duplicate selectors',t=>{
 const first=fixture(t),second=fixture(t);fs.unlinkSync(path.join(second.state,'assistant.json'));fs.writeFileSync(path.join(second.state,'provider.json'),JSON.stringify({url:'https://owner.example/v1/chat/completions',key:'test-only',model:'second-workspace'}));
 const {launcher}=installModelCommand({root:first.root,home:first.home});
 const metadata=JSON.parse(execFileSync(process.execPath,[launcher,'--workspace',second.root,'--check'],{env:{...process.env,GODSPEED_MODEL_WORKSPACE:first.root},encoding:'utf8'}));assert.equal(metadata.model,'second-workspace');
 assert.throws(()=>execFileSync(process.execPath,[launcher,'--workspace',second.root,'--workspace',first.root,'--check'],{stdio:'pipe'}));
});
test('the host command preserves profile text when UTF-8 characters cross input chunks',async t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.state,'assistant.json'));let captured;
 const server=http.createServer(async(req,res)=>{let bytes='';req.setEncoding('utf8');for await(const chunk of req)bytes+=chunk;captured=JSON.parse(bytes);res.end(JSON.stringify({choices:[{message:{content:'checked'}}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 fs.writeFileSync(path.join(f.state,'provider.json'),JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/chat',key:'test-only',model:'owner'}));
 const {launcher}=installModelCommand({root:f.root,home:f.home});
 const child=spawn(process.execPath,[launcher,'--workspace',f.root],{stdio:['pipe','pipe','pipe']}),bytes=Buffer.from(JSON.stringify({...input,prompt:'Grüße aus Köln 🐈'})),at=bytes.indexOf(Buffer.from('ü'))+1;let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
 child.stdin.write(bytes.subarray(0,at));await new Promise(resolve=>setTimeout(resolve,30));child.stdin.end(bytes.subarray(at));
 const code=await new Promise(resolve=>child.on('close',resolve));assert.equal(code,0,stderr);assert.equal(JSON.parse(stdout).text,'checked');assert.equal(captured.messages[1].content,'Grüße aus Köln 🐈');
});

// A BACKUP AI THE PERSON CONNECTED (discussion #20): an add-on gets it without a setup of its own,
// the main connection first, the backup only when that failed, and the answer says which answered.
function endpoint(t,reply){
 const seen=[];const server=http.createServer(async(req,res)=>{let bytes='';for await(const chunk of req)bytes+=chunk;seen.push({authorization:req.headers.authorization,body:JSON.parse(bytes)});const [status,body]=reply(seen.length);res.statusCode=status;res.end(JSON.stringify(body));});
 return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>{t.after(()=>new Promise(r=>server.close(r)));resolve({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',seen});}));
}
const answer=content=>[200,{choices:[{message:{content}}]}];
test('API-only Godspeed: the main address first, the backup address only when it failed, and the answer names it',async t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.state,'assistant.json'));let mainUp=false;
 const main=await endpoint(t,()=>mainUp?answer('from the main one'):[503,{error:{message:'overloaded'}}]),backup=await endpoint(t,()=>answer('from the backup'));
 fs.writeFileSync(path.join(f.state,'provider.json'),JSON.stringify({url:main.url,key:'main-key-test-only',model:'main-model'}));
 // No backup: today's behaviour, the main one's failure.
 await assert.rejects(addonModel({root:f.root,input}),/HTTP 503/);assert.equal(backup.seen.length,0);
 fs.writeFileSync(path.join(f.state,'provider-backup.json'),JSON.stringify({url:backup.url,key:'backup-key-test-only',model:'backup-model'}));
 assert.deepEqual(await addonModel({root:f.root,describe:true}),{configured:true,provider:'configured-api',model:'main-model',backup:{provider:'configured-api',model:'backup-model'}});
 const result=await addonModel({root:f.root,input});
 assert.deepEqual(result,{text:'from the backup',provider:'configured-api',model:'backup-model',backup:true});
 assert.equal(backup.seen[0].authorization,'Bearer backup-key-test-only');assert.equal(backup.seen[0].body.model,'backup-model');assert.equal(backup.seen[0].body.tools,undefined);
 // The next request tries the main one first again.
 mainUp=true;assert.deepEqual(await addonModel({root:f.root,input}),{text:'from the main one',provider:'configured-api',model:'main-model'});
 assert.equal(main.seen.length,3);assert.equal(backup.seen.length,1);
 const receipts=fs.readFileSync(path.join(f.state,'model-requests.jsonl'),'utf8').trim().split('\n').map(l=>JSON.parse(l));
 assert.deepEqual(receipts.map(r=>[r.state,r.model,r.backup||false]),[['failed',undefined,false],['answered','backup-model',true],['answered','main-model',false]]);
 for(const privateText of ['key-test-only','Invented person','from the'])assert.ok(!JSON.stringify(receipts).includes(privateText));
 const usage=JSON.parse(fs.readFileSync(path.join(f.state,'backup-ai.json'),'utf8'));assert.equal(usage.answers,1);assert.equal(usage.main_failing_since,undefined,'the main one answered again');
 // A backup that was removed is gone.
 mainUp=false;fs.unlinkSync(path.join(f.state,'provider-backup.json'));
 await assert.rejects(addonModel({root:f.root,input}),/HTTP 503/);assert.equal(backup.seen.length,1);
});
test('a Hermes installation reports the backup its helper used, and remembers the main one failing',async t=>{
 const f=fixture(t);
 const result=await addonModel({root:f.root,input,spawnProcess:fakeSpawn({text:'ok',provider:'openrouter',model:'backup-model',backup:true})});
 assert.deepEqual(result,{text:'ok',provider:'openrouter',model:'backup-model',backup:true});
 const usage=JSON.parse(fs.readFileSync(path.join(f.state,'backup-ai.json'),'utf8'));assert.equal(usage.answers,1);assert.ok(usage.main_failing_since);
 const last=JSON.parse(fs.readFileSync(path.join(f.state,'model-requests.jsonl'),'utf8').trim().split('\n').at(-1));assert.equal(last.backup,true);
 await addonModel({root:f.root,input,spawnProcess:fakeSpawn({text:'ok',provider:'openai-codex',model:'main'})});
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.state,'backup-ai.json'),'utf8')).main_failing_since,undefined);
 // An add-on can never ask for a route of its own.
 assert.throws(()=>modelInput({...input,route:'backup'}));
});
