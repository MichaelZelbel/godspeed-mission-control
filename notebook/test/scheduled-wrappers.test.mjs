import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {routineFiles,STARTING_ROUTINES} from '../core/starting-routines.mjs';

// THE GENERATED PYTHON WRAPPER OF #238's NIGHTLY CLEANUP, run the way Hermes runs it: it must reach its program.
const python=['python3','python'].find(p=>spawnSync(p,['--version']).status===0);
const needs={skip:!python&&'no Python here'};

function install(t,{entries={},configEntries={}}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-wrappers-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const home=path.join(root,'.hermes'),state=path.join(root,'.godspeed'),scripts=path.join(home,'scripts');
 const files=routineFiles({root,home,state,timezone:'Europe/Berlin'});
 fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(state,{recursive:true});
 const config={...JSON.parse(files['godspeed-routines.json'])};
 for(const [key,source] of Object.entries(entries)){const stand=path.join(root,'stand-in-'+key+'.mjs');fs.writeFileSync(stand,source);config[key]=stand;}
 Object.assign(config,configEntries);
 files['godspeed-routines.json']=JSON.stringify(config);
 for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(scripts,name),text);
 const run=script=>spawnSync(python,[path.join(scripts,script)],{cwd:scripts,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:120000});
 return {root,home,run};
}

test('the nightly cleanup wrapper removes an old run file and logs it',needs,t=>{
 const {root,run}=install(t);
 const old=path.join(root,'routines','research','2026-01-01','answer.txt');
 fs.mkdirSync(path.dirname(old),{recursive:true});fs.writeFileSync(old,'x');
 const long=new Date(Date.now()-60*86400000);fs.utimesSync(old,long,long);
 const r=run(STARTING_ROUTINES.find(s=>s.key==='cleanup').script);
 assert.equal(r.status,0,r.stderr);
 assert.ok(!fs.existsSync(old));
 assert.match(r.stderr,/research: freed .* in 1 file/);
});

test('the remembered-conversations wrapper dispatches to its configured command in the workspace',needs,t=>{
 const {root,run}=install(t,{entries:{memory_daily:"import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.cwd(),'memory-daily-wrapper.json'),JSON.stringify({cwd:process.cwd()}));"}});
 const r=run(STARTING_ROUTINES.find(s=>s.key==='memory-daily').script);
 assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'memory-daily-wrapper.json'),'utf8')),{cwd:root});
});

test('the Workouts wrapper uses the configured Node, private notebook door, and scheduled command',needs,t=>{
 const {root,run}=install(t,{entries:{workouts:"import fs from 'node:fs';fs.writeFileSync('workouts-wrapper.json',JSON.stringify({args:process.argv.slice(2),notebook:process.env.GODSPEED_WORKOUTS_NOTEBOOK}));"},configEntries:{workouts_notebook:'http://127.0.0.1:4321'}});
 const r=run('godspeed-workouts.py');assert.equal(r.status,0,r.stderr);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'workouts-wrapper.json'),'utf8')),{args:['run','--scheduled'],notebook:'http://127.0.0.1:4321'});
});
