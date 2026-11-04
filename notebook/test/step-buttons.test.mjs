import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {recordReport,delivered} from '../core/background-reports.mjs';
import {openStep} from '../core/waiting-steps.mjs';

for(const key of Object.keys(process.env))if(/^GODSPEED_/.test(key))delete process.env[key];
const here=path.dirname(fileURLToPath(import.meta.url)),stepScript=path.join(here,'..','bin','godspeed-step.mjs');
const python=['python3','python'].find(p=>spawnSync(p,['-c','print(1)'],{encoding:'utf8'}).stdout?.trim()==='1');

// Each case delivers real Telegram questions the way waiting-steps.test.mjs does, so the hand-off
// files are written by the real code; the Python side then plays the gateway and taps the buttons.
async function scenario(t,name,abouts){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-step-buttons-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{device:'vps'});store.save('settings',{id:'installation',owner:'vps',timezone:'UTC',delivery:'telegram'});
 const ids=[],messages=[];
 for(const about of abouts){
  const {id,message}=openStep(store,{about,question:'Shall I go on?',yes:'I will restart it now.',no:'I will leave it as it is.',by:'routine:test',chat:'telegram'});
  await recordReport(store,{text:message,about:'',steps:[id],routine:'notice',written:'assistant',delivery:'telegram'});delivered(store,message);
  ids.push(id);messages.push(message);
 }
 const r=spawnSync(python,['-I',path.join(here,'step-buttons.test.py'),name],{encoding:'utf8',windowsHide:true,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',
  STEP_ROOT:root,STEP_COMMAND:JSON.stringify([process.execPath,stepScript,'--godspeed',root]),STEP_IDS:JSON.stringify(ids),STEP_MESSAGES:JSON.stringify(messages)}});
 assert.equal(r.status,0,r.stdout+r.stderr);
}
const opts={skip:python?false:'no python on this computer'};
test('a Telegram question gets Yes and No, and Yes approves that step',opts,t=>scenario(t,'one_step',['The bot stopped.']));
test('two waiting steps: each message answers only its own step',opts,t=>scenario(t,'two_steps',['The bot stopped.','The disk is full.']));
test('a press by anyone but the owner changes nothing',opts,t=>scenario(t,'not_the_owner',['The bot stopped.']));
test('a second press changes nothing and says so',opts,t=>scenario(t,'second_press',['The bot stopped.']));
test('a press after a typed answer changes nothing and says so',opts,t=>scenario(t,'after_typed',['The bot stopped.']));
test('no Telegram client: no message goes out and the hand-off waits',opts,t=>scenario(t,'no_client',['The bot stopped.']));
test('a failed button send keeps the hand-off for the next look',opts,t=>scenario(t,'send_fails',['The bot stopped.']));
test('an expired hand-off is dropped and gets no buttons',opts,t=>scenario(t,'expired',['The bot stopped.']));
test('the installed plugin registers the step buttons with Telegram and closes them on unload',opts,t=>scenario(t,'registered',['The bot stopped.']));
