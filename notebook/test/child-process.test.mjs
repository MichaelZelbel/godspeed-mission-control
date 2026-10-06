import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';import {spawn} from 'node:child_process';
import {hermesProvider,commandProvider} from '../core/runtime.mjs';import {nativeAgent} from '../core/native-agent.mjs';import {transcribeRecording} from '../core/dictation.mjs';import {assistantEnvironment} from '../core/assistant-files.mjs';import {runChild} from '../core/child-process.mjs';

// A stand-in for Hermes: on Windows a link to this Node named hermes.exe, which
// runs the script named by its first argument from its working folder (as the
// reviewer's did); elsewhere a shell script doing the same.
export function fakeHermes(t,scripts={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-fake-hermes-')),bin=path.join(dir,'bin'),cwd=path.join(dir,'cwd');fs.mkdirSync(bin);fs.mkdirSync(cwd);
 let executable;
 if(process.platform==='win32'){executable=path.join(bin,'hermes.exe');try{fs.linkSync(process.execPath,executable);}catch{fs.copyFileSync(process.execPath,executable);}}
 else{executable=path.join(bin,'hermes');fs.writeFileSync(executable,'#!/bin/sh\nscript="$1"; shift\nexec "'+process.execPath+'" "$PWD/$script" "$@"\n',{mode:0o755});}
 for(const [name,source] of Object.entries(scripts))fs.writeFileSync(path.join(cwd,name),source);
 t.after(()=>{try{fs.rmSync(dir,{recursive:true,force:true});}catch{}});
 return {executable,cwd,home:dir,bin};
}
// What a real CLI does on a bad flag, a missing config or a sign-in error:
// it stops before it reads the question it was sent.
const exitsEarly='process.stderr.write("error: unrecognized arguments\\n");process.exit(2);';

test('an AI program that stops before reading a long prompt fails the request instead of ending the server',async t=>{
 const hermes=fakeHermes(t,{chat:exitsEarly});
 const run=hermesProvider({executable:hermes.executable,home:hermes.home,cwd:hermes.cwd});
 await assert.rejects(run({kind:'chat',context:{notes:'x'.repeat(300*1024)}}),/The AI request failed/);
 const agent=nativeAgent({executable:hermes.executable,home:hermes.home,cwd:hermes.cwd});
 await assert.rejects(agent({message:'x'.repeat(300*1024)}),/The AI request failed/);
});

test('an assistant command that stops early fails its call the same way',async t=>{
 const hermes=fakeHermes(t,{chat:exitsEarly});
 // commandProvider starts the program by its bare name from PATH.
 const saved=process.env.PATH;process.env.PATH=hermes.bin+path.delimiter+saved;t.after(()=>{process.env.PATH=saved;});
 const run=commandProvider({command:'hermes',args:['chat'],cwd:hermes.cwd});
 await assert.rejects(run({kind:'chat',context:'x'.repeat(300*1024)}),/exited with code 2/);
});

test('a German reply split inside a letter arrives whole',async()=>{
 const reply='Guten Morgen! Dein Orthopäde-Termin ist um 9 Uhr. Schöne Grüße.';
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  setImmediate(()=>{const bytes=Buffer.from(reply,'utf8'),cut=bytes.indexOf(Buffer.from('ä'))+1;child.stdout.write(bytes.subarray(0,cut));setTimeout(()=>{child.stdout.write(bytes.subarray(cut));child.stdout.end();setTimeout(()=>child.emit('close',0),20);},20);});
  return child;};
 const {reply:got}=await nativeAgent({executable:'hermes',home:'.',cwd:'.',spawnProcess})({message:'Wann ist mein Termin?'});
 assert.equal(got,reply);
 // Dictation reads its transcript the same way.
 const said={ok:true,text:'Schöne Grüße aus München'};
 const dictation=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();
  setImmediate(()=>{const bytes=Buffer.from(JSON.stringify(said)+'\n','utf8'),cut=bytes.indexOf(Buffer.from('ö'))+1;child.stdout.write(bytes.subarray(0,cut));setTimeout(()=>{child.stdout.end(bytes.subarray(cut));setTimeout(()=>child.emit('close',0),20);},20);});
  return child;};
 const result=await transcribeRecording({verified:true,sourceRoot:os.tmpdir(),executable:path.join(os.tmpdir(),'bin','hermes'),home:os.tmpdir()},os.tmpdir(),Buffer.from('fictional audio'),'audio/webm',{spawnProcess:dictation});
 assert.equal(result.text,said.text);
});

test('a chat through the original assistant has a time limit',async()=>{
 const spawnProcess=()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();return child;};
 const agent=nativeAgent({executable:'hermes',home:'.',cwd:'.',spawnProcess,timeLimit:200});
 const started=Date.now();await assert.rejects(agent({message:'Think forever'}),/did not finish within/);
 assert.ok(Date.now()-started<5000);
});

test('a stopped program that ignores the request to stop is killed, with what it started',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-stubborn-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pids=path.join(dir,'pids.txt'),script=path.join(dir,'stubborn.js');
 fs.writeFileSync(script,`const {spawn}=require('child_process'),fs=require('fs');process.on('SIGTERM',()=>{});
const grandchild=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(pids)},process.pid+' '+grandchild.pid);setInterval(()=>{},1000);`);
 // Long enough for a slow machine to start both programs before time runs out.
 const running=runChild(process.execPath,[script],{timeoutMs:8000,graceMs:300});
 for(const until=Date.now()+7500;!fs.existsSync(pids)&&Date.now()<until;)await new Promise(r=>setTimeout(r,100));
 await assert.rejects(running,error=>error.code==='TIMEOUT');
 const [parent,grandchild]=fs.readFileSync(pids,'utf8').split(' ').map(Number);
 // A killed program nobody has collected yet (a zombie, as under a container's process 1 that
 // collects nothing) is stopped: it runs nothing, it only has not been reaped.
 const zombie=pid=>{try{return /^\d+ \(.*\) Z/s.test(fs.readFileSync('/proc/'+pid+'/stat','utf8'));}catch{return false;}};
 const alive=pid=>{try{process.kill(pid,0);return !zombie(pid);}catch(error){return error.code==='EPERM';}};
 const until=Date.now()+8000;while((alive(parent)||alive(grandchild))&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
 assert.equal(alive(parent),false,'the program itself must be gone');assert.equal(alive(grandchild),false,'and what it started');
});

test('the tool-enabled assistant gets the variables it needs and none of the server\'s secrets',()=>{
 const env=assistantEnvironment({home:'/fictional/hermes',workspace:'/fictional/workspace',env:{PATH:'/usr/bin',HOME:'/home/owner',LANG:'de_DE.UTF-8',HTTPS_PROXY:'http://proxy.fictional:3128',PYTHONUTF8:'1',UV_CACHE_DIR:'/cache',HERMES_CRON_TIMEOUT:'900',OPENAI_API_KEY:'fictional-model-key',GODSPEED_ORIGINAL_RUNTIME:'on',GODSPEED_COMPUTER_PORT:'47445',GODSPEED_AGE_KEY:'/home/owner/.godspeed/age-key.txt',
  GODSPEED_ACCESS_TOKEN:'fictional-web-token',GODSPEED_SETUP_CODE:'fictional-setup-code',GODSPEED_CANDIDATE_BOT_TOKEN:'fictional-bot-token',GODSPEED_MODEL_KEY:'fictional-notebook-key',GODSPEED_EMBEDDINGS_KEY:'fictional-embeddings-key',GODSPEED_TELEGRAM_TOKEN:'fictional-telegram',TELEGRAM_BOT_TOKEN:'fictional-telegram',AWS_SECRET_ACCESS_KEY:'fictional-aws',GITHUB_TOKEN:'fictional-github',SUPABASE_ACCESS_TOKEN:'fictional-supabase'}});
 for(const name of ['HOME','LANG','HTTPS_PROXY','PYTHONUTF8','UV_CACHE_DIR','HERMES_CRON_TIMEOUT','OPENAI_API_KEY','GODSPEED_ORIGINAL_RUNTIME','GODSPEED_COMPUTER_PORT','GODSPEED_AGE_KEY'])assert.ok(env[name],name+' is needed by Hermes or its tools');
 assert.match(env.PATH,/\/usr\/bin/);assert.equal(env.HERMES_HOME,'/fictional/hermes');assert.equal(env.GODSPEED_WORKSPACE,'/fictional/workspace');
 for(const name of ['GODSPEED_ACCESS_TOKEN','GODSPEED_SETUP_CODE','GODSPEED_CANDIDATE_BOT_TOKEN','GODSPEED_MODEL_KEY','GODSPEED_EMBEDDINGS_KEY','GODSPEED_TELEGRAM_TOKEN','TELEGRAM_BOT_TOKEN','AWS_SECRET_ACCESS_KEY','GITHUB_TOKEN','SUPABASE_ACCESS_TOKEN'])assert.equal(env[name],undefined,name+' must not reach the assistant');
 // Windows names its variables in any case.
 const windows=assistantEnvironment({home:'C:\\h',workspace:'C:\\w',env:{Path:'C:\\Windows',SystemRoot:'C:\\Windows',ComSpec:'C:\\Windows\\cmd.exe',USERPROFILE:'C:\\Users\\o',LOCALAPPDATA:'C:\\Users\\o\\AppData\\Local',Godspeed_Access_Token:'fictional'}});
 assert.equal(windows.SystemRoot,'C:\\Windows');assert.ok(windows.ComSpec);assert.ok(windows.LOCALAPPDATA);assert.equal(windows.Godspeed_Access_Token,undefined);
});
