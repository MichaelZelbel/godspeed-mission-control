// #905: the Dashboard's arrival read (?check=1) must confirm the assistant runtime's AI afresh
// too. Until now hermesProvider had no check, so the route skipped the check on that path and the
// card could read "Ready to chat" from a chat-era state while every send failed. Its check is one
// billed one-turn chat, so only reads that ask for a check run it — a plain read (the chats'
// one-second poll, the model picker) never bills it, keeping the pacing #762/#794 set.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';

async function notebook(t,{mode='working'}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-arrival-hermes-')),bin=path.join(dir,'bin'),root=path.join(dir,'workspace');
 fs.mkdirSync(bin,{recursive:true});fs.mkdirSync(path.join(dir,'venv','bin'),{recursive:true});fs.mkdirSync(root,{recursive:true});
 let executable;
 if(process.platform==='win32'){executable=path.join(bin,'hermes.exe');fs.copyFileSync(process.execPath,executable);}
 else{executable=path.join(bin,'hermes');fs.writeFileSync(executable,'#!/bin/sh\nexec "'+process.execPath+'" "'+path.join(dir,'chat')+'"\n',{mode:0o755});}
 // The model list the picker reads is served by the Python beside the executable; this one answers
 // at once, without Hermes' own modules.
 fs.writeFileSync(path.join(dir,'venv','bin','python3'),'#!/bin/sh\necho \'{"current":"fake-model","models":[{"id":"fake-model","efforts":[]}]}\';\n',{mode:0o755});
 const modeFile=path.join(dir,'mode'),turns=path.join(dir,'turns');
 fs.writeFileSync(modeFile,mode);
 const chat="const fs=require('node:fs');let mode='working';try{mode=fs.readFileSync('"+modeFile+"','utf8').trim();}catch{}\nfs.appendFileSync('"+turns+"','turn\\n');\nif(mode==='down'){process.stderr.write('HTTP 500: the model is down\\n');process.exit(1);}\nprocess.stdout.write('OK');\n";
 fs.writeFileSync(path.join(dir,'chat'),chat);
 // On Windows the fake Hermes is this Node itself, which runs the script named by its first
 // argument from the workspace, so the same chat script is written there too.
 fs.writeFileSync(path.join(root,'chat'),chat);
 const assistant=path.join(dir,'assistant.json');
 fs.writeFileSync(assistant,JSON.stringify({verified:true,executable,home:dir,sourceRoot:dir}));
 const names=['GODSPEED_ORIGINAL_RUNTIME','GODSPEED_ASSISTANT_CONFIG','GODSPEED_MODEL_URL','GODSPEED_MODEL_KEY','GODSPEED_MODEL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 for(const n of names)delete process.env[n];
 process.env.GODSPEED_ORIGINAL_RUNTIME='on';process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 const {createService}=await import('../server/main.mjs');const service=await createService({root,port:0});
 t.after(async()=>{await service.close();for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+service.address.port;
 return {
  options:(search='')=>fetch(base+'/api/chat/options'+search).then(r=>r.json()),
  setMode:mode=>fs.writeFileSync(modeFile,mode),
  turns:()=>fs.existsSync(turns)?fs.readFileSync(turns,'utf8').split('\n').filter(Boolean).length:0,
 };
}

test('a plain read asks the assistant nothing while the Dashboard arrival read checks it once',async t=>{
 const page=await notebook(t);
 let now=Date.now();
 t.mock.method(Date,'now',()=>now);
 const arrival=await page.options('?check=1');
 assert.equal(arrival.usable,true);
 assert.equal(page.turns(),1,'the arrival read sent one billed check turn');
 const plain=await page.options();
 assert.equal(plain.usable,true);
 assert.equal(page.turns(),1,'a plain read sent nothing');
 for(let read=0;read<5;read++)await page.options();
 now+=5001;
 await page.options();
 assert.equal(page.turns(),1,'plain reads never run the billed check, not even past the five seconds the free check waits for');
});

test('ten Dashboard arrivals each check the assistant once and answer from it',async t=>{
 const page=await notebook(t);
 for(let i=1;i<=10;i++){
  const confirmed=await page.options('?check=1');
  assert.equal(confirmed.usable,true,'repeat '+i);
  assert.equal(page.turns(),i,'repeat '+i+': the arrival read checked the AI once');
 }
});

test('with the assistant\'s model down, the arrival read says the AI cannot be reached instead of Ready to chat',async t=>{
 const page=await notebook(t);
 assert.equal((await page.options('?check=1')).usable,true);
 page.setMode('down');
 const arrival=await page.options('?check=1');
 assert.equal(arrival.usable,false,'the arrival read no longer answers usable:true while every request to the AI fails');
 assert.equal(arrival.availability,'unreachable');
 assert.equal(page.turns(),2,'the arrival read ran the check that found the outage');
 // A plain read keeps the honest state: it asks nothing, and it never overrules the check.
 const plain=await page.options();
 assert.equal(plain.usable,false);assert.equal(plain.availability,'unreachable');
 page.setMode('working');
 assert.equal((await page.options('?check=1')).usable,true,'the next arrival read sees the AI answer again');
});
