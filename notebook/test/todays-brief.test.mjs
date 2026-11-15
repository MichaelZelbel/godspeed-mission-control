import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {machineDevice} from '../core/device-id.mjs';
import {QueryService} from '../core/query.mjs';

// "Today's brief" in Telegram (9 November 2026): the gateway answers it with the briefing the
// notebook saved today, before the model (assistant-files/godspeed-reply/todays_brief.py), through
// `godspeed-brief --saved`, which only reads.
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const here=path.dirname(fileURLToPath(import.meta.url));

test("godspeed-reply: today's brief in Telegram is the saved briefing, before the model",()=>{
 const result=spawnSync(python,[path.join(here,'todays-brief.test.py'),'-v'],{encoding:'utf8',timeout:120000,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.equal(result.status,0,(result.stdout||'')+(result.stderr||'')+(result.error?.message||''));
});

test('morning-brief.mjs --saved prints the saved briefing and never writes one',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-saved-brief-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{device:machineDevice(root).id});
 const script=fileURLToPath(new URL('../scripts/morning-brief.mjs',import.meta.url));
 const run=()=>spawnSync(process.execPath,[script,'--saved','--godspeed',root],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:root}});
 const notes=()=>new QueryService(new Store(root,{device:machineDevice(root).id})).rows('notes').length;
 const before=notes(),empty=run();
 assert.equal(empty.status,0,empty.stderr);assert.equal(empty.stdout,'','nothing saved today, nothing printed');
 assert.equal(notes(),before,'and nothing written');
 store.save('notes',{title:'Your morning briefing',content:'The fictional garden needs water today.',source_app:'morning-brief',brief_day:new Date().toISOString().slice(0,10)});
 const saved=run();
 assert.equal(saved.status,0,saved.stderr);assert.equal(saved.stdout,'The fictional garden needs water today.\n');
});
