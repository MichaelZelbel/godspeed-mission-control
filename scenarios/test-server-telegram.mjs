import test from 'node:test';
import assert from 'node:assert/strict';
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
