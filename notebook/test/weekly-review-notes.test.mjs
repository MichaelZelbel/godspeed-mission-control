import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains,weekNotes} from '../core/domains.mjs';

// The weekly review sent the week's notes whole; on the real notebook the
// model's answer was cut off mid-JSON and the review failed.
test('a weekly review gets each note\'s beginning, newest first, within a budget, and room to answer',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-weekly-'))),domains=new Domains(new QueryService(store));
  for(let i=0;i<120;i++)store.save('notes',{title:'Fictional note '+i,content:'word '.repeat(3000)});
  let sent;domains.provider=async input=>{sent=input;return {week_summary:'Fictional week',themes:[],open_loops:[],connections:[],gaps:[],people_summary:[],stats:{}};};
  await domains.invoke('weekly-review',{days:7});
  assert.ok(JSON.stringify(sent.notes).length<=62000);assert.ok(sent.notes.every(n=>n.text.length<=800));assert.equal(sent.max_tokens,8000);
  assert.equal(weekNotes([{title:'a',created_at:'2026-01-01',content:'x'},{title:'b',created_at:'2026-02-01',content:'y'}])[0].title,'b');
});
