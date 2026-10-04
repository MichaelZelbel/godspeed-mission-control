import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,hash} from '../core/records/store.mjs';import {backup} from '../core/archives.mjs';import {RecoveryRunner} from '../core/recovery-runner.mjs';
test('separate recovery checks preserve event-loop progress, share concurrent work and retain exact bytes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-recovery-worker-')),store=new Store(root),media=path.join(store.state,'media');fs.mkdirSync(media);
 store.save('notes',{id:'fictional-source',title:'Fictional recovery evidence',content:'Exact retained fictional bytes.'});fs.writeFileSync(path.join(media,'fixture.bin'),Buffer.alloc(16*1024*1024,173));
 const source=path.join(store.state,'backups','fixture');backup(store,media,source);const runner=new RecoveryRunner(store);
 let progress=0;const timer=setInterval(()=>progress++,5);
 try{
  const first=runner.run(source),same=runner.run(source);assert.equal(first,same);
  await assert.rejects(runner.run(source+'-other'),/already being checked/);
  const result=await first;assert.ok(progress>0,'Restoration must allow health and chat timers to run');assert.equal(result.verified,true);
  assert.equal(fs.readdirSync(path.join(store.state,'restored-copies')).length,1);
  assert.equal(hash(fs.readFileSync(path.join(result.media,'fixture.bin'))),hash(fs.readFileSync(path.join(media,'fixture.bin'))));
  assert.equal(new Store(result.workspace).get('notes','fictional-source').content,'Exact retained fictional bytes.');assert.equal(store.get('notes','fictional-source').revision,1);
 }finally{clearInterval(timer);}
});
test('a failed recovery worker refuses changed backup bytes without touching the live workspace',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-recovery-worker-fail-'))),media=path.join(store.state,'media');fs.mkdirSync(media);
 store.save('notes',{id:'fictional-preserved',content:'Live fictional content'});const source=path.join(store.state,'backups','fixture');backup(store,media,source);
 fs.appendFileSync(path.join(source,'records/notes/fictional-preserved.md'),'\nUnapproved alteration');
 await assert.rejects(new RecoveryRunner(store).run(source),/integrity mismatch/);assert.equal(store.get('notes','fictional-preserved').content,'Live fictional content');
});
