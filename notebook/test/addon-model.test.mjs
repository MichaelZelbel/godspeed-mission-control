import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {execFileSync,spawn} from 'node:child_process';
import {addonModel,modelInput,modelConnection,assistantCheck} from '../core/addon-model.mjs';
import {installModelCommand} from '../scripts/install-model-command.mjs';
import {chooseAssistant} from '../scripts/choose-assistant.mjs';

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
test('an add-on follows the native package-manager Hermes launcher to its own Python and source',t=>{
 const f=fixture(t),source=path.join(f.home,'hermes-agent'),python=path.join(f.home,'tools','python-current','bin','python3');
 const put=(file,text='')=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 put(python);put(path.join(source,'hermes_cli','__init__.py'));
 const inner=put(path.join(source,'.hermes','bin','hermes'),"#!/bin/sh\nexec \""+python+"\" -I -c 'import sys\nsys.path.insert(0, '\"'\"'"+source+"'\"'\"')\nimport hermes_bootstrap\n' \"$@\"\n");
 const outer=put(path.join(f.root,'.local','bin','hermes'),'#!/bin/sh\nexec "'+inner+'" "$@"\n');
 fs.writeFileSync(path.join(f.state,'assistant.json'),JSON.stringify({verified:true,home:f.home,executable:outer}));
 const connection=modelConnection(f.root);
 assert.equal(connection.python,python);assert.equal(connection.sourceRoot,source);assert.equal(connection.descriptor.home,f.home);
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

// 26 OCTOBER 2026: on a server updated as root, the launcher's Python existed but could not load
// Hermes (a module it needs was missing), the source's own venv could, and the add-on was told to
// check its connection and usage allowance. Each Python of that one Hermes is tried until one loads
// it, that one is remembered, and when none does the message says what happened.
function incident(t){
 const f=fixture(t),source=path.join(f.root,'opt','hermes-src');
 const put=(file,text='')=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
 put(path.join(source,'hermes_cli','__init__.py'));
 const managed=put(path.join(source,'.hermes','tools','python-3.14.7','bin','python3')),venv=put(path.join(source,'venv','bin','python3'));
 const inner=put(path.join(source,'.hermes','bin','hermes'),"#!/bin/sh\nexec "+managed+" -I -c 'import sys\nsys.path.insert(0, '\"'\"'"+source+"'\"'\"')\nimport hermes_bootstrap\n' \"$@\"\n");
 const executable=put(path.join(f.root,'root','.local','bin','hermes'),'#!/bin/sh\nexec '+inner+' "$@"\n');
 fs.writeFileSync(path.join(f.state,'assistant.json'),JSON.stringify({verified:true,home:f.home,executable}));
 return {...f,source,managed,venv,executable,memory:path.join(f.state,'assistant-python.json')};
}
// Answers by the Python asked: [exit code, what it prints], or 'cannot start' (the program is missing).
function spawnBy(replies,calls){
 return (executable,args,options)=>{
  calls.push(executable);const reply=replies[executable];
  if(reply==='cannot start'){const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();setImmediate(()=>child.emit('error',Object.assign(Error('spawn ENOENT'),{code:'ENOENT'})));return child;}
  const [code,body]=reply;return fakeSpawn(body,{code})(executable,args,options);
 };
}
const notLoaded=[1,{error:'Godspeed could not load its AI program (Hermes) on this computer.',reason:'runtime',missing:'ruamel'}];
test('a Python that cannot load Hermes hands the request to the next one of the same Hermes, which is remembered',async t=>{
 const f=incident(t),calls=[],replies={[f.managed]:notLoaded,[f.venv]:[0,{text:'ok',provider:'openai-codex',model:'main'}]};
 assert.deepEqual(modelConnection(f.root).candidates.map(c=>c.python),[f.managed,f.venv]);
 assert.equal((await addonModel({root:f.root,input,spawnProcess:spawnBy(replies,calls)})).text,'ok');
 assert.deepEqual(calls,[f.managed,f.venv]);
 assert.equal(JSON.parse(fs.readFileSync(f.memory,'utf8')).python,f.venv);
 calls.length=0;await addonModel({root:f.root,input,spawnProcess:spawnBy(replies,calls)});
 assert.deepEqual(calls,[f.venv],'the next request starts with the one that worked');
 // The executable changed (Hermes was reinstalled): its own Python first again, and it works now.
 const later=new Date(Date.now()+60000);fs.utimesSync(f.executable,later,later);
 calls.length=0;await addonModel({root:f.root,describe:true,spawnProcess:spawnBy({...replies,[f.managed]:[0,{configured:true,provider:'openai-codex',model:'main'}]},calls)});
 assert.deepEqual(calls,[f.managed]);
 assert.equal(fs.existsSync(f.memory),false,'nothing to remember when the first one works');
});
test('a remembered Python that stops loading Hermes is passed over too, and so is one that cannot start',async t=>{
 const f=incident(t),calls=[];
 fs.writeFileSync(f.memory,JSON.stringify({executable:f.executable,mtime:fs.statSync(f.executable).mtimeMs,python:f.venv}));
 const result=await addonModel({root:f.root,input,spawnProcess:spawnBy({[f.venv]:notLoaded,[f.managed]:[0,{text:'ok',provider:'p',model:'m'}]},calls)});
 assert.equal(result.text,'ok');assert.deepEqual(calls,[f.venv,f.managed]);
 assert.equal(fs.existsSync(f.memory),false);
 calls.length=0;
 assert.equal((await addonModel({root:f.root,input,spawnProcess:spawnBy({[f.managed]:'cannot start',[f.venv]:[0,{text:'ok',provider:'p',model:'m'}]},calls)})).text,'ok');
 assert.deepEqual(calls,[f.managed,f.venv]);
 // A memory naming a Python outside this Hermes is never followed.
 fs.writeFileSync(f.memory,JSON.stringify({executable:f.executable,mtime:fs.statSync(f.executable).mtimeMs,python:path.join(f.root,'elsewhere','python3')}));
 assert.equal(modelConnection(f.root).python,f.managed);
});
test('when no Python of that Hermes loads it, the message names that, never the usage allowance',async t=>{
 const f=incident(t),calls=[];
 const error=await addonModel({root:f.root,input,spawnProcess:spawnBy({[f.managed]:notLoaded,[f.venv]:notLoaded},calls)}).catch(error=>error);
 assert.equal(error.message,'Godspeed could not load its AI program (Hermes) on this computer: the Python module ruamel is missing. No AI was asked, so this is not a usage limit or a sign-in problem.');
 assert.deepEqual(calls,[f.managed,f.venv]);assert.equal(fs.existsSync(f.memory),false);
 // Only a plain module name reaches the message.
 const odd=await addonModel({root:f.root,input,spawnProcess:spawnBy({[f.managed]:[1,{error:'x',reason:'runtime',missing:'key sk-test-only'}],[f.venv]:[1,{error:'x',reason:'runtime'}]},[])}).catch(error=>error);
 assert.match(odd.message,/could not load its AI program \(Hermes\) on this computer: it stopped while starting\./);assert.doesNotMatch(odd.message,/sk-test-only/);
 // No Python at all.
 fs.rmSync(f.managed);fs.rmSync(f.venv);
 await assert.rejects(addonModel({root:f.root,input}),/could not load its AI program \(Hermes\) on this computer: no Python for it was found/);
});
test('a model that failed after Hermes loaded is never asked again through another Python',async t=>{
 const f=incident(t),calls=[];
 await assert.rejects(addonModel({root:f.root,input,spawnProcess:spawnBy({[f.managed]:[1,{error:'x',reason:'limit'}],[f.venv]:[0,{text:'twice',provider:'p',model:'m'}]},calls)}),/usage limit/);
 assert.deepEqual(calls,[f.managed]);
 await assert.rejects(addonModel({root:f.root,input,spawnProcess:spawnBy({[f.managed]:[1,'not the helper\'s answer'],[f.venv]:[0,{text:'twice',provider:'p',model:'m'}]},calls)}),/invalid answer/);
 assert.deepEqual(calls,[f.managed,f.managed]);
});
test('the installer\'s check says whether Hermes loads, through its own Python or another, without asking any AI',async t=>{
 const f=incident(t),check=replies=>{const calls=[];return assistantCheck({root:f.root,executable:f.executable,home:f.home,spawnProcess:spawnBy(replies,calls)}).then(result=>({...result,calls}));};
 const described=[0,{configured:true,provider:'p',model:'m'}],unchosen=[1,{error:'The selected Godspeed model could not answer. Check its connection and usage allowance.',reason:null}];
 assert.deepEqual(await check({[f.managed]:described}),{loads:true,direct:true,configured:true,calls:[f.managed]});
 assert.deepEqual(await check({[f.managed]:notLoaded,[f.venv]:described}),{loads:true,direct:false,configured:true,calls:[f.managed,f.venv]});
 assert.deepEqual(await check({[f.managed]:unchosen}),{loads:true,direct:true,configured:false,calls:[f.managed]},'no model chosen yet is no broken Hermes');
 assert.deepEqual(await check({[f.managed]:notLoaded,[f.venv]:notLoaded}),{loads:false,why:'the Python module ruamel is missing',calls:[f.managed,f.venv]});
 const asked=[];await assistantCheck({root:f.root,executable:f.executable,home:f.home,spawnProcess:fakeSpawn(described[1],{onSpawn:c=>asked.push(c.input)})});
 assert.deepEqual(asked,[{describe:true}]);
 assert.equal(fs.existsSync(f.memory),false,'a check remembers nothing');
});

// WHICH HERMES AN UPDATE LEAVES THE NOTEBOOK AND ITS ADD-ONS (26 October 2026,
// scripts/choose-assistant.mjs). An update run as root on a server wrote root's own launcher of a
// Hermes another account owns, which could not load Hermes as root, over the one that worked, and
// nothing checked. The installer now checks the Hermes it finds the way an add-on's connection is
// checked, and keeps the one before when only that one works. The check itself (assistantCheck) is
// tested above; here a stand-in answers for each executable.
function installation(t,before){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-choose-assistant-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=name=>{const file=path.join(root,name,'hermes');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'');return file;};
 const found=put('found'),earlier=put('earlier'),home=path.join(root,'home');
 fs.mkdirSync(path.join(root,'.godspeed'));
 if(before)fs.writeFileSync(path.join(root,'.godspeed','assistant.json'),JSON.stringify({verified:true,executable:before==='earlier'?earlier:before,home}));
 const descriptor=()=>JSON.parse(fs.readFileSync(path.join(root,'.godspeed','assistant.json'),'utf8'));
 return {root,found,earlier,home,descriptor};
}
const works={loads:true,direct:true,configured:true},onlyThroughAnother={loads:true,direct:false,configured:true},broken={loads:false,why:'the Python module ruamel is missing'};
async function choose(f,answers){
 const said=[],checked=[];
 const chosen=await chooseAssistant({root:f.root,found:f.found,home:f.home,say:line=>said.push(line),check:async({executable,home,root})=>{assert.equal(home,f.home);assert.equal(root,f.root);checked.push(executable);return answers[executable];}});
 return {chosen,said,checked};
}

test('the Hermes found is written and nothing said when it loads through its own Python',async t=>{
 const f=installation(t,'earlier');
 const r=await choose(f,{[f.found]:works});
 assert.equal(r.chosen,f.found);assert.deepEqual(r.said,[]);assert.deepEqual(r.checked,[f.found],'the one before is not even checked');
 assert.deepEqual(f.descriptor(),{verified:true,executable:f.found,home:f.home});
});

test('a Hermes found that does not load never replaces the one that did, and the installer says why',async t=>{
 const f=installation(t,'earlier');
 const r=await choose(f,{[f.found]:broken,[f.earlier]:works});
 assert.equal(r.chosen,f.earlier);assert.equal(f.descriptor().executable,f.earlier);assert.equal(f.descriptor().home,f.home);
 assert.deepEqual(r.said,[`The Hermes found at ${f.found} does not load for this account (the Python module ruamel is missing), so Godspeed keeps using the one at ${f.earlier}, which does.`]);
 // Also when the one before loads only through another Python of its own installation.
 assert.equal((await choose(f,{[f.found]:broken,[f.earlier]:onlyThroughAnother})).chosen,f.earlier);
});

test('a Hermes found that starts only through another Python gives way to one that starts through its own',async t=>{
 const f=installation(t,'earlier');
 const r=await choose(f,{[f.found]:onlyThroughAnother,[f.earlier]:works});
 assert.equal(r.chosen,f.earlier);
 assert.match(r.said[0],/does not start with its own Python for this account, so Godspeed keeps using the one at /);
 // When the one before is no better, the one found stays, and nothing needs saying: add-ons reach it.
 const same=await choose(f,{[f.found]:onlyThroughAnother,[f.earlier]:onlyThroughAnother});
 assert.equal(same.chosen,f.found);assert.deepEqual(same.said,[]);
 const worse=await choose(f,{[f.found]:onlyThroughAnother,[f.earlier]:broken});
 assert.equal(worse.chosen,f.found);assert.equal(f.descriptor().executable,f.found);
});

test('when no Hermes loads, the installer says so plainly and goes on with the one found',async t=>{
 const f=installation(t,'earlier');
 const r=await choose(f,{[f.found]:broken,[f.earlier]:broken});
 assert.equal(r.chosen,f.found);assert.equal(f.descriptor().executable,f.found);
 assert.deepEqual(r.said,[`Hermes, the AI program Godspeed uses, does not load for this account at ${f.found} (the Python module ruamel is missing). Until it does, add-ons and the assistant cannot reach an AI; everything else was installed. Run hermes once as this account to see why.`]);
 // A first installation has no Hermes before it, and one whose Hermes is gone has none to go back to.
 for(const before of [null,path.join(f.root,'removed','hermes')]){
  const g=installation(t,before),seen=await choose(g,{[g.found]:broken});
  assert.equal(seen.chosen,g.found);assert.deepEqual(seen.checked,[g.found]);assert.match(seen.said[0],/does not load for this account/);
 }
 // The same Hermes as before is checked once.
 const g=installation(t,null);fs.writeFileSync(path.join(g.root,'.godspeed','assistant.json'),JSON.stringify({verified:true,executable:g.found,home:g.home}));
 assert.deepEqual((await choose(g,{[g.found]:broken})).checked,[g.found]);
});

test('the installer lets this step choose, after the assistant is wired and before the notebook starts',()=>{
 const script=fs.readFileSync(new URL('../scripts/install-native-notebook.sh',import.meta.url),'utf8').replaceAll('\r','');
 const wire=script.indexOf('scripts/wire-assistant.mjs" "$HERMES_HOME"'),choose=script.indexOf('"$node" --no-warnings "$version/notebook/scripts/choose-assistant.mjs" "$root" "$assistant"'),start=script.indexOf('native-start-script.mjs" "$state/start.mjs"');
 assert.ok(wire>0&&choose>wire&&start>choose,'wired, then chosen, then started');
 assert.doesNotMatch(script,/assistant\.json'\),JSON\.stringify\(\{verified:true,executable:process\.argv\[2\]/,'the unchecked write is gone');
});
