import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,encode} from '../core/records/store.mjs';
import {localParts as journalParts} from '../../third-party/addons/godspeed-journal/lib/clock.mjs';
import {localParts as coachParts,zonedToUtc} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {readEntries,writeEntry} from '../../third-party/addons/godspeed-journal/lib/store.mjs';
test('repeated record reads see actual external bytes even with restored metadata and isolate mutated caller objects',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-responsive-records-')),store=new Store(root),note=store.save('notes',{title:'Fictional cached source',content:'Alpha',tags:['original']}),file=store.file(note),before=fs.statSync(file);
 const first=store.get('notes',note.id),originalHash=first._hash;first.content='Caller mutation';first.tags.push('not saved');assert.equal(store.get('notes',note.id).content,'Alpha');assert.deepEqual(store.get('notes',note.id).tags,['original']);
 fs.writeFileSync(file,encode({...note,content:'Bravo'}));fs.utimesSync(file,before.atime,before.mtime);assert.equal(store.get('notes',note.id).content,'Bravo');assert.notEqual(store.get('notes',note.id)._hash,originalHash);
 fs.writeFileSync(file,'Broken canonical bytes');assert.equal(store.get('notes',note.id),undefined);assert.ok(store.problems.length);fs.writeFileSync(file,encode(note));assert.equal(store.get('notes',note.id).content,'Alpha');assert.equal(store.problems.length,0);
 fs.renameSync(file,file.replace('.md','-foreign.md'));store.scan();assert.equal(store.records.size,0);assert.ok(store.problems.some(p=>p.error.includes('identity')));
});
test('cached clocks keep different time zones and daylight-saving folds distinct and journal history unchanged',()=>{
 for(const parts of [journalParts,coachParts]){assert.equal(parts(new Date('2026-10-25T00:30:00Z'),'Europe/Berlin').hm,'02:30');assert.equal(parts(new Date('2026-10-25T01:30:00Z'),'Europe/Berlin').hm,'02:30');assert.equal(parts(new Date('2026-10-25T01:30:00Z'),'UTC').hm,'01:30');assert.equal(parts(new Date('2026-10-25T01:30:00Z'),'America/New_York').date,'2026-10-24');assert.throws(()=>parts(new Date(),'Fictional/Invalid'),RangeError);}
 assert.equal(zonedToUtc('2026-10-24','19:00','Europe/Berlin').toISOString(),'2026-10-24T17:00:00.000Z');assert.equal(zonedToUtc('2026-10-25','19:00','Europe/Berlin').toISOString(),'2026-10-25T18:00:00.000Z');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-responsive-journal-')),settings={timezone:'Europe/Berlin'},until=new Date('2026-10-04T23:05:00Z');writeEntry(root,settings,{kind:'note',words:'Fictional retained late local entry'},new Date('2026-10-04T23:00:00Z'));writeEntry(root,settings,{kind:'note',words:'Fictional future entry'},new Date('2026-10-04T23:10:00Z'));assert.deepEqual(readEntries(root,settings,{days:3650,until}).map(e=>e.words),['Fictional retained late local entry']);
});
