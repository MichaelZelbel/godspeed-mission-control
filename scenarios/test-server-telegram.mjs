import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {baselineSent,captureSent} from './server-telegram.mjs';

test('the first action after setup ignores the setup handoff message',()=>{
  const state={sent:2,outbox:[{label:'setup-first-install',text:'Setup question'}]};
  baselineSent(state,{sent:[{text:'Start'},{text:'Setup question'},{text:'Gateway ready'}]});
  captureSent(state,{sent:[{text:'Start'},{text:'Setup question'},{text:'Gateway ready'},{text:'Today\'s brief'}]},'todays-brief');

  assert.deepEqual(state.outbox,[
    {label:'setup-first-install',text:'Setup question'},
    {label:'todays-brief',kind:'sendMessage',chat_id:undefined,text:"Today's brief",buttons:[],accepted:true},
  ]);
  assert.equal(state.sent,4);
});

test('actions and marked routines keep complete Telegram records',()=>{
  const action={sent:0,outbox:[]};
  const routine={sent:0,outbox:[]};
  const record={sent:[{chat_id:31415,text:'The report is ready.',buttons:[{text:'Open'}]}]};

  captureSent(action,record,'owner-question');
  captureSent(routine,record,'report');

  assert.deepEqual(action.outbox,[{
    label:'owner-question',kind:'sendMessage',chat_id:31415,text:'The report is ready.',buttons:[{text:'Open'}],accepted:true,
  }]);
  assert.deepEqual(routine.outbox,[{
    label:'report',kind:'sendMessage',chat_id:31415,text:'The report is ready.',buttons:[{text:'Open'}],accepted:true,
  }]);
  assert.equal(action.sent,1);
  assert.equal(routine.sent,1);
});

test('mark saves complete sent records through its command boundary',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'server-telegram-mark-'));
  const bin=path.join(folder,'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'sudo'),`#!/bin/sh
printf '%s\\n' '{"sent":[{"chat_id":31415,"text":"The report is ready.","buttons":[{"text":"Open"}]}],"requests":[{"method":"sendMessage"}]}'
`);
  fs.chmodSync(path.join(bin,'sudo'),0o755);

  try {
    execFileSync(process.execPath,['server-telegram.mjs','mark','--server','fixture','--evidence',folder,'--label','report','--kind','routine'],{
      cwd:path.dirname(new URL(import.meta.url).pathname),
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`},
      stdio:'pipe',
    });

    const expected={
      label:'report',kind:'sendMessage',chat_id:31415,text:'The report is ready.',buttons:[{text:'Open'}],accepted:true,
    };
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8')),{
      steps:[{label:'report',kind:'routine',success:true,request_end:1}],outbox:[expected],
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'telegram-run.json'),'utf8')),{
      steps:[{label:'report',kind:'routine',success:true,request_end:1}],outbox:[expected],sent:1,
    });
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});
