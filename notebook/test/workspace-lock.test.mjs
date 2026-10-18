import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
// A lock file another writer has just created, before it wrote its name, read
// as "Workspace lock requires recovery" (6 October 2026). It is a busy
// workspace: the write waits and then goes through.
test('a lock that is still being written means busy, and the write goes through once it is released',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-lock-'))),lock=path.join(store.state,'workspace.lock');
  fs.mkdirSync(store.state,{recursive:true});fs.writeFileSync(lock,'');
  assert.throws(()=>store.withLock(()=>1),e=>e.code==='WRITER_BUSY');
  setTimeout(()=>fs.unlinkSync(lock),100);
  assert.equal(await store.withLockAsync(()=>'written',{timeoutMs:5000}),'written');
  assert.equal(fs.existsSync(lock),false,'released');
  // An empty lock left for a minute is a writer that crashed before naming
  // itself. Until 6 October 2026 it needed recovery by hand; it is taken over.
  fs.writeFileSync(lock,'');const old=new Date(Date.now()-60000);fs.utimesSync(lock,old,old);
  assert.equal(store.withLock(()=>'taken over'),'taken over');assert.equal(fs.existsSync(lock),false);
});
