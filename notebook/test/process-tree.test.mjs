import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {terminateOwnedTree} from '../core/process-tree.mjs';
test('service recovery stops its detached descendants and preserves a sibling process',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-owned-process-')),worker=path.join(dir,'worker.mjs'),parent=path.join(dir,'parent.mjs'),parentBeat=path.join(dir,'parent.txt'),grandBeat=path.join(dir,'grand.txt'),siblingBeat=path.join(dir,'sibling.txt');
 fs.writeFileSync(worker,"import fs from 'node:fs';setInterval(()=>fs.appendFileSync(process.argv[2],'x'),50)");
 fs.writeFileSync(parent,"import {spawn} from 'node:child_process';import fs from 'node:fs';spawn(process.execPath,[process.argv[2],process.argv[3]],{detached:true,stdio:'ignore'});setInterval(()=>fs.appendFileSync(process.argv[4],'x'),50)");
 const child=spawn(process.execPath,[parent,worker,grandBeat,parentBeat],{windowsHide:true,stdio:'ignore'}),sibling=spawn(process.execPath,[worker,siblingBeat],{windowsHide:true,stdio:'ignore'}),delay=ms=>new Promise(r=>setTimeout(r,ms));
 try{const until=Date.now()+5000;while(![parentBeat,grandBeat,siblingBeat].every(f=>fs.existsSync(f))&&Date.now()<until)await delay(50);assert.ok([parentBeat,grandBeat,siblingBeat].every(f=>fs.existsSync(f)));terminateOwnedTree(child);await delay(1200);const before=[parentBeat,grandBeat,siblingBeat].map(f=>fs.statSync(f).size);await delay(300);const after=[parentBeat,grandBeat,siblingBeat].map(f=>fs.statSync(f).size);assert.deepEqual(after.slice(0,2),before.slice(0,2));assert.ok(after[2]>before[2]);}
 finally{terminateOwnedTree(child);terminateOwnedTree(sibling);}
});
