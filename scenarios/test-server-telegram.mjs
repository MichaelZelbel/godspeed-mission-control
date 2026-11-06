import test from 'node:test';
import assert from 'node:assert/strict';
import {baselineSent,captureSent} from './server-telegram.mjs';

test('the first action after setup ignores the setup handoff message',()=>{
  const state={sent:2,outbox:[{label:'setup-first-install',text:'Setup question'}]};
  baselineSent(state,{sent:[{text:'Start'},{text:'Setup question'},{text:'Gateway ready'}]});
  captureSent(state,{sent:[{text:'Start'},{text:'Setup question'},{text:'Gateway ready'},{text:'Today\'s brief'}]},'todays-brief','say');

  assert.deepEqual(state.outbox,[
    {label:'setup-first-install',text:'Setup question'},
    {label:'todays-brief',kind:'sendMessage',chat_id:undefined,text:"Today's brief",buttons:[],accepted:true},
  ]);
  assert.equal(state.sent,4);
});
