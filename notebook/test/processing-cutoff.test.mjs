import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {NoteProcessing} from '../core/processing.mjs';

// Automatic processing takes the notes written since it started; the ones
// from before (the 1,753 Menerio processed) are never touched. It judged by
// the time of the last edit, so starring an old note, or any small change,
// made it a candidate and it was processed and paid for again (7 October
// 2026). A note belongs to the time it was written.
test('a note from before processing started is not processed after an edit',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-cutoff-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root,{device:'vps'}),query=new QueryService(store),domains=new Domains(query);
  store.save('settings',{id:'installation',owner:'vps',timezone:'Europe/Berlin'});
  store.save('settings',{id:'processing',enabled:true,daily_limit:5,quiet_minutes:0,min_chars:5,retry_minutes:30,max_attempts:3,since:'2026-01-01T00:00:00.000Z'});
  const old=store.save('notes',{title:'From Menerio',content:'Fictional Ana and I climbed in 2025, a note Menerio processed.',created_at:'2025-03-01T10:00:00.000Z'});
  store.save('notes',{id:old.id,is_favorite:true});
  const fresh=store.save('notes',{title:'New',content:'Fictional Ana and I go climbing on Monday the 12th.'});
  const processing=new NoteProcessing({store,query,domains,device:'vps'});
  assert.deepEqual(processing.candidates().map(c=>c.note.id),[fresh.id]);
});
