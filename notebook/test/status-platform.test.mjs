import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';

// Settings shows "Open the Windows assistant" only when the notebook runs on Windows (28 October 2026,
// issue #4: the button was on every install and worked on Windows only). The page learns the machine
// from the status answer, so that answer must carry it.
const server=fileURLToPath(new URL('../server/main.mjs',import.meta.url));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const {port}=s.address();s.close(()=>resolve(port));});});

test('the status answer says which system the notebook runs on',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-platform-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const port=await freePort(),env={...Object.fromEntries(Object.entries(process.env).filter(([name])=>!/^GODSPEED_/i.test(name))),GODSPEED_WORKSPACE:root,GODSPEED_PORT:String(port)};
 const child=spawn(process.execPath,[server],{env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 try{
  let status=null;for(const until=Date.now()+30000;!status&&Date.now()<until;){try{const r=await fetch('http://127.0.0.1:'+port+'/api/status');if(r.ok)status=await r.json();}catch{}if(!status)await new Promise(r=>setTimeout(r,250));}
  assert.ok(status,'the notebook started');
  assert.equal(status.platform,process.platform);
 }finally{child.kill();await new Promise(r=>child.once('exit',r));}
});
