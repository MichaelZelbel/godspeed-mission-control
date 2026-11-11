import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createRequire} from 'node:module';
import {installStarter} from '../core/starter-workspace.mjs';import {writeRoutinePromise,promiseDue} from '../core/routine-promises.mjs';
import {STARTING_ROUTINES} from '../core/starting-routines.mjs';
const {parsePromise}=createRequire(import.meta.url)('../../tools/promises.js');

// Setup writes the promise of each routine it schedules into work/promises/, once, and never over a
// promise that is already there.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-routine-promises-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const NOW=new Date('2026-11-10T14:00:00Z');
const brief={kind:'brief',name:'Morning brief',what:'Writes your morning brief: the one thing that needs you, what changed, your dates and what your watches found.',schedule:'30 6 * * *',timezone:'Europe/Berlin',now:NOW};
const folder=root=>path.join(root,'work','promises');

test('a fresh install has the promises folder and its README inside work/, not at the top',t=>{
 const root=temporary(t);installStarter(root);
 assert.ok(fs.statSync(path.join(folder(root),'README.md')).isFile());
 assert.equal(fs.existsSync(path.join(root,'promises')),false);
});

test('a routine\'s promise is written once, readable by the checker, in plain words',t=>{
 const root=temporary(t);installStarter(root);
 assert.equal(writeRoutinePromise(root,brief),'written');
 const file=path.join(folder(root),'routine-brief.md'),text=fs.readFileSync(file,'utf8');
 assert.deepEqual(parsePromise(text).errors,[]);
 const {fields}=parsePromise(text);
 assert.equal(fields.DUE,'daily 06:30 Europe/Berlin');assert.equal(fields.STARTED,'2026-11-11');assert.equal(fields.ROUTINE,'brief');
 assert.equal(fields.PROOF,'dates-in routines/ran/brief.txt');
 assert.equal(text.includes('—'),false);
 assert.equal(writeRoutinePromise(root,brief),'kept');assert.equal(fs.readFileSync(file,'utf8'),text);
});

test('a promise the person edited or renamed keeps every byte',t=>{
 const root=temporary(t);installStarter(root);
 const edited=path.join(folder(root),'routine-brief.md');fs.writeFileSync(edited,'my own words\n');
 assert.equal(writeRoutinePromise(root,brief),'kept');assert.equal(fs.readFileSync(edited,'utf8'),'my own words\n');
 fs.renameSync(edited,path.join(folder(root),'my-brief.md'));fs.writeFileSync(path.join(folder(root),'my-brief.md'),'PROMISE: mine\nROUTINE: brief\n');
 assert.equal(writeRoutinePromise(root,brief),'kept');
 assert.deepEqual(fs.readdirSync(folder(root)).sort(),['README.md','my-brief.md']);
 assert.equal(fs.readFileSync(path.join(folder(root),'my-brief.md'),'utf8'),'PROMISE: mine\nROUTINE: brief\n');
});

test('a mission control without the folder gets nothing, not even the folder',t=>{
 const root=temporary(t);
 assert.equal(writeRoutinePromise(root,brief),'no-folder');assert.equal(fs.existsSync(path.join(root,'work')),false);
});

test('every starting routine\'s schedule is a promise the checker can read, and the odd ones are refused',t=>{
 const root=temporary(t);installStarter(root);
 for(const routine of STARTING_ROUTINES){
  assert.notEqual(promiseDue(routine.schedule),null,routine.schedule);
  assert.equal(writeRoutinePromise(root,{kind:routine.key,name:routine.name,what:routine.what,schedule:routine.schedule,timezone:'UTC',now:NOW}),'written',routine.key);
  assert.deepEqual(parsePromise(fs.readFileSync(path.join(folder(root),'routine-'+routine.key+'.md'),'utf8')).errors,[],routine.key);
 }
 assert.deepEqual(promiseDue('*/15 * * * *'),{cadence:'daily',when:'daily',time:'00:00'});
 assert.deepEqual(promiseDue('0 18 * * 0'),{cadence:'weekly',when:'sunday',time:'18:00'});
 assert.deepEqual(promiseDue('0 9 1 * *'),{cadence:'monthly',when:'1',time:'09:00'});
 for(const odd of ['0 8 * * 1-5','1440m','0 9 30 * *'])assert.equal(promiseDue(odd),null,odd);
 assert.equal(writeRoutinePromise(root,{...brief,kind:'weekdays',schedule:'0 8 * * 1-5'}),'unsupported');
});
