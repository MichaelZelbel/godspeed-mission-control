import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';

// The one-click setup chat asks whether a Mission Control is already on GitHub. A yes is
// connected by the notebook's own code ("connect"), the way Settings' Connect record sync
// connects it, and the last step then files only the clock and Telegram, with no goal.
const finish=fileURLToPath(new URL('../scripts/telegram-setup-finish.mjs',import.meta.url));
const run=(root,input,args=[])=>spawnSync(process.execPath,['--no-warnings',finish,...args],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:120000,env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_DEVICE:'vps'}});
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-tg-finish-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};

test('connect refuses what Settings refuses, says why, and connects nothing',t=>{
  const root=workspace(t),result=run(root,{repository:'not-an-address'},['connect']);
  assert.equal(result.status,1);
  assert.match(result.stderr,/Use a GitHub repository address without embedded credentials/);
  assert.equal(fs.existsSync(path.join(root,'.godspeed','sync-config.json')),false);
});

test('a Mission Control brought in keeps its goals and settings; only the clock and Telegram are filed',t=>{
  const root=workspace(t);new Store(root).save('settings',{id:'installation',owner:'desktop-3f9a1c2e',timezone:'America/New_York',delivery:'notebook'});
  const result=run(root,{timezone:'Europe/London',goal:null,joined:true});
  assert.equal(result.status,0,result.stderr);
  const settings=new Store(root).get('settings','installation');
  assert.deepEqual([settings.owner,settings.timezone,settings.delivery],['desktop-3f9a1c2e','Europe/London','telegram'],'the routines stay where the reader has them');
  assert.equal(new Store(root).list('goals').length,0,'no goal is made up');
  const empty=workspace(t),before=run(empty,{timezone:'Europe/London',goal:null,joined:true});
  assert.equal(before.status,0,before.stderr);assert.match(before.stdout,/arrive with the first sync/);
  assert.ok(!new Store(empty).get('settings','installation'),'nothing to file onto yet, and nothing invented');
});
