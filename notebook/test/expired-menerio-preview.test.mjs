import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {MenerioImport} from '../server/menerio-import.mjs';
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-menerio-preview-'));

function withPreview(ageMs){
  const store=new Store(root()),importer=new MenerioImport(store,path.join(store.root,'media'));
  importer.save({id:'11111111-1111-4111-8111-111111111111',state:'ready',progress:'Your preview is ready.',
    startedAt:new Date(Date.now()-ageMs).toISOString(),
    summary:{notes:1033,trashedNotes:0,contacts:271,attachments:4,keptExisting:0,archivedTables:0},
    copyDate:new Date(Date.now()-ageMs).toISOString()});
  return importer;
}

// Michael's preview said 1,033 nodes and offered "Import this copy", which could
// only answer "This preview expired. Prepare a new preview." The one button the
// error offered re-read the status and changed nothing, so the screen was a dead
// end: a count, a button, and no way forward.
test('a preview past its day is not offered as importable',async()=>{
  const importer=withPreview(25*60*60*1000);
  const status=importer.status();
  assert.notEqual(status.job.state,'ready','an expired preview must not still read as ready');
  assert.equal(status.job.state,'expired');
  assert.match(status.job.error,/prepare a new preview/i,'the status must say what to do: '+status.job.error);
  assert.equal(status.job.summary,undefined,'a count that can no longer be imported must not be shown');
  await assert.rejects(importer.start({action:'apply',id:'11111111-1111-4111-8111-111111111111'}),/prepare a new preview/i);
});

test('a preview from the same day is still importable',()=>{
  const status=withPreview(60*60*1000).status();
  assert.equal(status.job.state,'ready');
  assert.equal(status.job.summary.notes,1033);
});
