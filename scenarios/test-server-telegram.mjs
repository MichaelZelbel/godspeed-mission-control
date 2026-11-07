import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {captureSent} from './server-telegram.mjs';

test('the first action after setup ignores the setup handoff message',()=>{
  const state={sent:2,outbox:[{label:'setup-first-install',text:'Setup question'}]};
  state.sent=3;
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
  const record={sent:[{chat_id:31415,text:'The report is ready.',buttons:[{label:'Open',callback:'open:report'}]}]};

  captureSent(action,record,'owner-question');
  captureSent(routine,record,'report');

  assert.deepEqual(action.outbox,[{
    label:'owner-question',kind:'sendMessage',chat_id:31415,text:'The report is ready.',buttons:['open:report'],accepted:true,
  }]);
  assert.deepEqual(routine.outbox,[{
    label:'report',kind:'sendMessage',chat_id:31415,text:'The report is ready.',buttons:['open:report'],accepted:true,
  }]);
  assert.equal(action.sent,1);
  assert.equal(routine.sent,1);
});

test('marking a scheduled delivery leaves only the later reply for its chat action',()=>{
  const state={sent:1,outbox:[{label:'setup-first-install',text:'Setup question'}]};
  const scheduled={chat_id:31415,text:'Scheduled morning brief',buttons:[]};
  const reply={chat_id:31415,text:'Scheduled morning brief',buttons:[]};

  captureSent(state,{sent:[{text:'Setup question'},scheduled]},'scheduled-brief');
  captureSent(state,{sent:[{text:'Setup question'},scheduled,reply]},'todays-brief');

  assert.deepEqual(state.outbox,[
    {label:'setup-first-install',text:'Setup question'},
    {label:'scheduled-brief',kind:'sendMessage',chat_id:31415,text:'Scheduled morning brief',buttons:[],accepted:true},
    {label:'todays-brief',kind:'sendMessage',chat_id:31415,text:'Scheduled morning brief',buttons:[],accepted:true},
  ]);
  assert.equal(state.sent,3);
});

test('mark saves complete sent records through its command boundary',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'server-telegram-mark-'));
  const bin=path.join(folder,'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'sudo'),`#!/bin/sh
printf '%s\\n' '{"sent":[{"chat_id":31415,"text":"Yesterday\\u0027s report.","buttons":[{"label":"Open","callback":"open:yesterday"}]},{"chat_id":31415,"text":"The report is ready.","buttons":[{"label":"Open","callback":"open:report"}]}],"requests":[{"method":"sendMessage"},{"method":"sendMessage"}]}'
`);
  fs.chmodSync(path.join(bin,'sudo'),0o755);
  const old={
    label:'yesterday-report',kind:'sendMessage',chat_id:31415,text:"Yesterday's report.",buttons:['open:yesterday'],accepted:true,
  };
  fs.writeFileSync(path.join(folder,'telegram-run.json'),JSON.stringify({
    steps:[{label:'yesterday-report',kind:'routine',success:true,request_end:1}],outbox:[old],sent:1,
  }));

  try {
    execFileSync(process.execPath,['server-telegram.mjs','mark','--server','fixture','--evidence',folder,'--label','report','--kind','routine'],{
      cwd:path.dirname(new URL(import.meta.url).pathname),
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`},
      stdio:'pipe',
    });

    const expected={
      label:'report',kind:'sendMessage',chat_id:31415,text:'The report is ready.',buttons:['open:report'],accepted:true,
    };
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8')),{
      steps:[
        {label:'yesterday-report',kind:'routine',success:true,request_end:1},
        {label:'report',kind:'routine',success:true,request_end:2},
      ],outbox:[old,expected],sent:2,
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'telegram-run.json'),'utf8')),{
      steps:[
        {label:'yesterday-report',kind:'routine',success:true,request_end:1},
        {label:'report',kind:'routine',success:true,request_end:2},
      ],outbox:[old,expected],sent:2,
    });
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

test('say reaches the fake Bot API through its command boundary',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'server-telegram-say-'));
  const bin=path.join(folder,'bin'),trace=path.join(folder,'trace');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'sudo'),`#!/bin/sh
input=$(cat)
printf '%s %s\\n' "$*" "$input" >> "$TRACE"
n=$(grep -c __act "$TRACE" 2>/dev/null); replies=''; i=0
while [ "$i" -lt "\${n:-0}" ]; do replies="$replies,{\\"chat_id\\":31415,\\"text\\":\\"Answered.\\"}"; i=$((i+1)); done
printf '{"sent":[%s],"requests":[]}\\n' "\${replies#,}"
`);
  fs.chmodSync(path.join(bin,'sudo'),0o755);

  try {
    execFileSync(process.execPath,['server-telegram.mjs','say','--server','fixture','--evidence',folder,'--label','question','--text','What now?'],{
      cwd:path.dirname(new URL(import.meta.url).pathname),
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`,TRACE:trace},
      stdio:'pipe',
    });

    assert.match(fs.readFileSync(trace,'utf8'),/http:\/\/127\.0\.0\.1:8081\/__act/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8')),{steps:[{label:'question',kind:'say',success:true,request_start:0,request_end:0}],outbox:[{label:'question',kind:'sendMessage',chat_id:31415,text:'Answered.',buttons:[],accepted:true}],sent:1});
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

test('press resolves each visible button label to its installed callback token',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'server-telegram-press-'));
  const bin=path.join(folder,'bin'),trace=path.join(folder,'trace');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'sudo'),`#!/bin/sh
input=$(cat)
printf '%s %s\\n' "$*" "$input" >> "$TRACE"
n=$(grep -c __act "$TRACE" 2>/dev/null)
edits=''; i=0
while [ "$i" -lt "\${n:-0}" ]; do edits="$edits,\\"Approved.\\""; i=$((i+1)); done
printf '{"sent":[{"chat_id":31415,"text":"Cancel the renewal of your gym membership?","buttons":[{"label":"No","callback":"gss1:gym-no"},{"label":"Yes","callback":"gss1:gym-yes"}]},{"chat_id":31415,"text":"Book the car inspection?","buttons":[{"label":"Yes","callback":"gss1:car-yes"},{"label":"No","callback":"gss1:car-no"}]}],"edits":[%s],"requests":[]}\\n' "\${edits#,}"
`);
  fs.chmodSync(path.join(bin,'sudo'),0o755);

  try {
    fs.writeFileSync(path.join(folder,'telegram-run.json'),JSON.stringify({steps:[],outbox:[],sent:2}));
    execFileSync(process.execPath,['server-telegram.mjs','press','--server','fixture','--evidence',folder,'--label','gym','--question','gym membership','--button','Yes'],{
      cwd:path.dirname(new URL(import.meta.url).pathname),
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`,TRACE:trace},
      stdio:'pipe',
    });
    execFileSync(process.execPath,['server-telegram.mjs','press','--server','fixture','--evidence',folder,'--label','inspection','--question','car inspection','--button','No'],{
      cwd:path.dirname(new URL(import.meta.url).pathname),
      env:{...process.env,PATH:`${bin}:${process.env.PATH}`,TRACE:trace},
      stdio:'pipe',
    });

    const requests=fs.readFileSync(trace,'utf8');
    assert.match(requests,/"press":"gss1:gym-yes"/);
    assert.match(requests,/"press":"gss1:car-no"/);
    assert.doesNotMatch(requests,/"press":"Yes"|"press":"No"/);
  } finally {
    fs.rmSync(folder,{recursive:true,force:true});
  }
});

function fixture(name,script){
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),`server-telegram-${name}-`));
  const bin=path.join(folder,'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'sudo'),script);
  fs.chmodSync(path.join(bin,'sudo'),0o755);
  const run=(...args)=>execFileSync(process.execPath,['server-telegram.mjs',...args,'--server','fixture','--evidence',folder],{
    cwd:path.dirname(new URL(import.meta.url).pathname),
    env:{...process.env,PATH:`${bin}:${process.env.PATH}`,TRACE:path.join(folder,'trace'),COUNT:path.join(folder,'reads')},
    stdio:'pipe',
  });
  return {folder,run};
}
const seed=(folder,sent)=>fs.writeFileSync(path.join(folder,'telegram-run.json'),JSON.stringify({steps:[],outbox:[],sent}));

test('say waits for a reply that arrives after the old fixed delay',()=>{
  const {folder,run}=fixture('late',`#!/bin/sh
cat >/dev/null
if grep -q __act "$TRACE" 2>/dev/null; then :; fi
case "$*" in *__act*) echo act >> "$TRACE";; *) if [ -f "$TRACE" ]; then echo read >> "$COUNT"; fi;; esac
reads=$(grep -c read "$COUNT" 2>/dev/null)
if [ "\${reads:-0}" -ge 4 ]; then late=',{"chat_id":31415,"text":"Late answer."}'; else late=''; fi
printf '{"sent":[{"chat_id":31415,"text":"Earlier."}%s],"requests":[]}\n' "$late"
`);
  try {
    seed(folder,1);
    run('say','--label','question','--text','What now?');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8')).outbox.map(message=>message.text),['Late answer.']);
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});

test('an owner message nobody accounts for fails the next step',()=>{
  const {folder,run}=fixture('stray',`#!/bin/sh
cat >/dev/null
printf '{"sent":[{"chat_id":31415,"text":"Stray."}],"requests":[]}\n'
`);
  try {
    assert.throws(()=>run('say','--label','question','--text','What now?'));
    const steps=JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8')).steps;
    assert.equal(steps[0].success,false);
    assert.match(steps[0].error,/no step accounts for/);
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});

test('snapshot labels and rejects a message sent after the last step',()=>{
  const {folder,run}=fixture('snapshot',`#!/bin/sh
cat >/dev/null
printf '{"sent":[{"chat_id":31415,"text":"First."},{"chat_id":31415,"text":"Second."}],"requests":[],"state":"gateway"}\n'
`);
  try {
    seed(folder,1);
    assert.throws(()=>run('snapshot'));
    const saved=JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8'));
    assert.deepEqual(saved.outbox.map(message=>[message.label,message.text]),[['snapshot','Second.']]);
    assert.equal(saved.sent,2);
    assert.match(execFileSync(process.execPath,['telegram-judge.mjs','failed',path.join(folder,'run.json')],{cwd:path.dirname(new URL(import.meta.url).pathname),encoding:'utf8'}),/snapshot/);
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});

test('setup attributes every message of a multi-part reply to the step before it',()=>{
  const {folder,run}=fixture('setup',`#!/bin/sh
input=$(cat)
case "$*" in
  *__act*) echo act >> "$TRACE"; exit 0;;
  *47831*) echo '{"start_message":"/start abc"}'; exit 0;;
  *runner.json*) echo '{"state":"gateway"}'; exit 0;;
  *setup.json*) echo '{"done":true}'; exit 0;;
  *record.json*) ;;
  *) exit 0;;
esac
n=$(grep -c act "$TRACE" 2>/dev/null); n=\${n:-0}
sent=''
[ "$n" -ge 1 ] && sent='{"chat_id":31415,"text":"Hi","buttons":[]},{"chat_id":31415,"text":"Which?","buttons":[{"label":"A","callback":"anthropic"}]}'
[ "$n" -ge 2 ] && sent="$sent"',{"chat_id":31415,"text":"Key?","buttons":[]}'
[ "$n" -eq 3 ] && echo read >> "$COUNT"
[ "$n" -ge 3 ] && sent="$sent"',{"chat_id":31415,"text":"Thanks","buttons":[]}'
reads=$(grep -c read "$COUNT" 2>/dev/null)
[ "$n" -ge 3 ] && { [ "$n" -gt 3 ] || [ "\${reads:-0}" -ge 3 ]; } && sent="$sent"',{"chat_id":31415,"text":"Connected","buttons":[]},{"chat_id":31415,"text":"First?","buttons":[{"label":"No","callback":"have:no"}]}'
[ "$n" -ge 4 ] && sent="$sent"',{"chat_id":31415,"text":"Done","buttons":[]}'
printf '{"sent":[%s],"requests":[]}\\n' "$sent"
`);
  try {
    run('setup','--token','t','--ai-key','k');
    const saved=JSON.parse(fs.readFileSync(path.join(folder,'run.json'),'utf8'));
    assert.deepEqual(saved.steps.map(step=>step.success),[true,true,true,true]);
    assert.equal(saved.outbox.length,saved.sent);
    assert.deepEqual(saved.outbox.map(message=>message.label),['setup-start','setup-start','setup-provider','setup-key','setup-key','setup-key','setup-first-install']);
  } finally { fs.rmSync(folder,{recursive:true,force:true}); }
});
