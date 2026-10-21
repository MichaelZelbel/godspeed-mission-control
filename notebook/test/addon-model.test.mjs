import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync} from 'node:child_process';
import {addonModel,modelInput} from '../core/addon-model.mjs';
import {installModelCommand} from '../scripts/install-model-command.mjs';

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-addons-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const state=path.join(root,'.godspeed'),runtime=path.join(root,'runtime'),home=path.join(state,'current-assistant');fs.mkdirSync(state,{recursive:true});fs.mkdirSync(runtime);fs.mkdirSync(home);
 const executable=path.join(runtime,'hermes'),python=path.join(runtime,'python3');fs.writeFileSync(executable,'');fs.writeFileSync(python,'');
 fs.writeFileSync(path.join(state,'assistant.json'),JSON.stringify({verified:true,executable,home,sourceRoot:runtime}));
 return {root,state,home,runtime};
}
const input={system:'Evaluate only this fictional profile.',prompt:'Invented person who likes sailing.'};
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
