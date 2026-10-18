import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../core/records/store.mjs';
import {SearchIndex} from '../core/index/search.mjs';

// The search index is derived from the notebook and can always be built
// again. One whose first page still read but whose tables were damaged (a
// crash during a write, a bad disk sector) opened, then failed at the first
// read with "database disk image is malformed", and the server could not
// start, again on every restart (7 October 2026). A damaged index is set
// aside and built again, wherever the damage is.
for(const background of [false,true])test('an index damaged beyond its first page is set aside and built again'+(background?' (server start)':''),async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-index-damage-'));let index;
  t.after(async()=>{try{await index?.ready;}catch{}try{index?.close();}catch{}fs.rmSync(root,{recursive:true,force:true});});
  const store=new Store(root);
  for(let i=0;i<300;i++)store.save('notes',{title:'Note '+i,content:'Lighthouse keeper number '+i+' '+'words '.repeat(80)});
  const first=new SearchIndex(store);first.close();
  const file=path.join(store.state,'search.sqlite');
  // The schema (page 1) and the small table that says which form the index
  // has stay readable, so the index opens; every other page is overwritten.
  const db=new DatabaseSync(file),keep=new Set([1,...db.prepare("SELECT rootpage FROM sqlite_master WHERE tbl_name='meta'").all().map(r=>r.rootpage)]);db.close();
  const bytes=fs.readFileSync(file),page=bytes.readUInt16BE(16)||65536;
  assert.ok(bytes.length>page*4,'the index spans several pages');
  for(let n=1;n*page<=bytes.length;n++)if(!keep.has(n))for(let at=(n-1)*page;at<n*page;at++)bytes[at]=(at*31)&0xff;
  fs.writeFileSync(file,bytes);
  assert.doesNotThrow(()=>{index=new SearchIndex(store,{background});});
  if(background)await index.ready;
  assert.equal(index.recovered,true);
  assert.ok(fs.readdirSync(store.state).some(n=>n.startsWith('search.sqlite.corrupt-')),'the damaged index is kept aside');
  const found=await index.searchHybrid('Lighthouse keeper',{limit:5});
  assert.ok(found.rows.length>0);
});
