import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';
import {fileCoachPrepRepair,repairId} from '../scripts/coach-prep-repair.mjs';

// A talk whose preparation failed its review three times in a row (#135): mc-coach-prep files one
// repair item in the work list (notebook/scripts/coach-prep-repair.mjs), the way the morning
// briefing files its own, and a fourth failure finds it open and files no second one.
const script=fileURLToPath(new URL('../scripts/coach-prep-repair.mjs',import.meta.url));
const repairs=root=>new QueryService(new Store(root)).rows('work_items').filter(r=>r.kind==='repair');

test('three failed tries file one repair item, and a fourth files no second one',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coach-repair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const issues=path.join(root,'issues.txt');fs.writeFileSync(issues,'- The 12 percent rise is not in the source text.\n- buffer: no route was weighed.\n');
 const run=()=>spawnSync(process.execPath,[script,'--godspeed',root,'--area','health','--talk','2026-11-04','--title','Health','--tries','3','--issues-file',issues],{encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);assert.equal(first.stdout.trim(),'filed '+repairId('health','2026-11-04'));
 const items=repairs(root);assert.equal(items.length,1);
 assert.equal(items[0].state,'needs_review');
 assert.match(items[0].title,/^The Health talk of 2026-11-04 could not be prepared: its preparation failed its review 3 times in a row$/);
 assert.deepEqual(items[0].issues,['The 12 percent rise is not in the source text.','buffer: no route was weighed.']);
 const fourth=run();assert.equal(fourth.status,0,fourth.stderr);assert.match(fourth.stdout,/^already open /);
 assert.equal(repairs(root).length,1);
 // Another talk is its own item.
 fileCoachPrepRepair({root,area:'health',talk:'2026-11-11',title:'Health'});assert.equal(repairs(root).length,2);
});

test('an item the person closed is filed again when the talk fails again',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coach-repair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.equal(fileCoachPrepRepair({root,area:'work',talk:'2026-11-05'}).filed,true);
 const store=new Store(root),id=repairId('work','2026-11-05');store.save('work_items',{...store.get('work_items',id),state:'verified'});
 assert.equal(fileCoachPrepRepair({root,area:'work',talk:'2026-11-05'}).filed,true);
 assert.equal(new Store(root).get('work_items',id).state,'needs_review');
});

// #359: a talk that opened without its preparation gets the same kind of item, under the same id,
// asking for the next talk to be ready.
test('a talk that opened without its preparation files one item that asks for the next talk to be ready',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coach-repair-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const run=()=>spawnSync(process.execPath,[script,'--godspeed',root,'--area','health','--talk','2026-11-08','--title','Health','--opened-unprepared','none was written','--next','2026-11-15'],{encoding:'utf8'});
 const first=run();assert.equal(first.status,0,first.stderr);assert.equal(first.stdout.trim(),'filed '+repairId('health','2026-11-08'));
 const [item]=repairs(root);
 assert.equal(item.title,'The Health talk of 2026-11-08 opened without a reviewed preparation: none was written');
 assert.equal(item.check,'The next Health talk (2026-11-15) has a preparation that passes its review (godspeed-coach prep-check health --date 2026-11-15 says ready)');
 assert.deepEqual([item.tries,item.error,item.state],[0,'none was written','needs_review']);
 const again=run();assert.equal(again.status,0,again.stderr);assert.match(again.stdout,/^already open /);
 assert.equal(repairs(root).length,1);
 assert.equal(spawnSync(process.execPath,[script,'--godspeed',root,'--area','health','--talk','2026-11-01','--opened-unprepared','x','--next','soon'],{encoding:'utf8'}).status,2);
});
