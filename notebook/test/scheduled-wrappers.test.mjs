import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
import {routineFiles,STARTING_ROUTINES} from '../core/starting-routines.mjs';
import {CONNECTION_SCRIPT} from '../core/notebook-routines.mjs';

// THE GENERATED PYTHON WRAPPERS OF #238's TWO SCHEDULED ROUTINES, run the way Hermes runs them: the
// connection check must receive --server only on a server, and the nightly cleanup must reach its program.
const python=['python3','python'].find(p=>spawnSync(p,['--version']).status===0);
const needs={skip:!python&&'no Python here'};

function install(t,{server,entries={}}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-wrappers-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:5}));
 const home=path.join(root,'.hermes'),state=path.join(root,'.godspeed'),scripts=path.join(home,'scripts');
 const files=routineFiles({root,home,state,timezone:'Europe/Berlin',server});
 fs.mkdirSync(scripts,{recursive:true});fs.mkdirSync(state,{recursive:true});
 const config={...JSON.parse(files['godspeed-routines.json'])};
 for(const [key,source] of Object.entries(entries)){const stand=path.join(root,'stand-in-'+key+'.mjs');fs.writeFileSync(stand,source);config[key]=stand;}
 files['godspeed-routines.json']=JSON.stringify(config);
 for(const [name,text] of Object.entries(files))fs.writeFileSync(path.join(scripts,name),text);
 const run=script=>spawnSync(python,[path.join(scripts,script)],{cwd:scripts,encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},timeout:120000});
 return {root,home,run};
}

for(const server of [true,false])test('the connection check wrapper '+(server?'passes':'does not pass')+' --server on a '+(server?'server':'computer'),needs,t=>{
 const {root,run}=install(t,{server,entries:{connection_check:'import fs from "node:fs";fs.writeFileSync(process.env.GODSPEED_ROOT+"/argv.json",JSON.stringify(process.argv.slice(2)));'}});
 const r=run(CONNECTION_SCRIPT);
 assert.equal(r.status,0,r.stderr);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'argv.json'),'utf8')).includes('--server'),server);
});

test('the nightly cleanup wrapper removes an old run file and logs it',needs,t=>{
 const {root,run}=install(t,{server:false});
 const old=path.join(root,'routines','research','2026-01-01','answer.txt');
 fs.mkdirSync(path.dirname(old),{recursive:true});fs.writeFileSync(old,'x');
 const long=new Date(Date.now()-60*86400000);fs.utimesSync(old,long,long);
 const r=run(STARTING_ROUTINES.find(s=>s.key==='cleanup').script);
 assert.equal(r.status,0,r.stderr);
 assert.ok(!fs.existsSync(old));
 assert.match(r.stderr,/research: freed .* in 1 file/);
});
