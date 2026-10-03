import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {terminateOwnedTree} from '../core/process-tree.mjs';
test('service recovery stops its detached descendants and preserves a sibling process',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-owned-process-')),worker=path.join(dir,'worker.mjs'),parent=path.join(dir,'parent.mjs'),parentBeat=path.join(dir,'parent.txt'),grandBeat=path.join(dir,'grand.txt'),siblingBeat=path.join(dir,'sibling.txt');
 fs.writeFileSync(worker,"import fs from 'node:fs';setInterval(()=>fs.appendFileSync(process.argv[2],'x'),50)");
 fs.writeFileSync(parent,"import {spawn} from 'node:child_process';import fs from 'node:fs';spawn(process.execPath,[process.argv[2],process.argv[3]],{detached:true,stdio:'ignore'});setInterval(()=>fs.appendFileSync(process.argv[4],'x'),50)");
 const child=spawn(process.execPath,[parent,worker,grandBeat,parentBeat],{windowsHide:true,stdio:'ignore'}),sibling=spawn(process.execPath,[worker,siblingBeat],{windowsHide:true,stdio:'ignore'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
 try{const until=Date.now()+5000;while(![parentBeat,grandBeat,siblingBeat].every(f=>fs.existsSync(f))&&Date.now()<until)await delay(50);assert.ok([parentBeat,grandBeat,siblingBeat].every(f=>fs.existsSync(f)));terminateOwnedTree(child);await delay(1200);const before=[parentBeat,grandBeat,siblingBeat].map(f=>fs.statSync(f).size);await delay(300);const after=[parentBeat,grandBeat,siblingBeat].map(f=>fs.statSync(f).size);assert.deepEqual(after.slice(0,2),before.slice(0,2));assert.ok(after[2]>before[2]);}
 finally{terminateOwnedTree(child);terminateOwnedTree(sibling);}
});
test('Linux shutdown waits to stop a detached descendant that ignores TERM',{skip:process.platform!=='linux'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-resistant-process-')),worker=path.join(dir,'worker.mjs'),parent=path.join(dir,'parent.mjs'),stopper=path.join(dir,'stopper.mjs'),beat=path.join(dir,'beat.txt'),pidFile=path.join(dir,'pid.txt');
 fs.writeFileSync(worker,"import fs from 'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[3],String(process.pid));setInterval(()=>fs.appendFileSync(process.argv[2],'x'),50)");
 fs.writeFileSync(parent,"import {spawn} from 'node:child_process';spawn(process.execPath,[process.argv[2],process.argv[3],process.argv[4]],{detached:true,stdio:'ignore'});setInterval(()=>{},1000)");
 fs.writeFileSync(stopper,"import {spawn} from 'node:child_process';import {terminateOwnedTree} from "+JSON.stringify(new URL('../core/process-tree.mjs',import.meta.url).href)+";const child=spawn(process.execPath,process.argv.slice(2),{stdio:'ignore'});setTimeout(()=>terminateOwnedTree(child),1000)");
 const wrapper=spawn(process.execPath,[stopper,parent,worker,beat,pidFile],{stdio:'ignore'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Stopper did not finish')),10000);wrapper.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Stopper failed'));});});assert.ok(fs.existsSync(beat));const before=fs.statSync(beat).size;await delay(300);assert.equal(fs.statSync(beat).size,before);}
 finally{terminateOwnedTree(wrapper);if(fs.existsSync(beat)&&fs.existsSync(pidFile)){const before=fs.statSync(beat).size;await delay(100);if(fs.statSync(beat).size!==before)try{process.kill(Number(fs.readFileSync(pidFile,'utf8')),'SIGKILL');}catch{}}}
});
