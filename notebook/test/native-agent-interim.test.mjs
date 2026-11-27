import test from 'node:test';
import assert from 'node:assert/strict';
import {hermesTurn} from '../core/native-agent.mjs';

const line=record=>JSON.stringify(record)+'\n';

test('what the assistant says before a tool call is an interim message, the result text is the reply',()=>{
 const stdout=line({type:'system',subtype:'init'})+line({type:'text',text:'Now let me '})+line({type:'text',text:'run the backtest.'})
  +line({type:'tool_use',name:'terminal'})+line({type:'tool_result',name:'terminal',output:'ok'})
  +line({type:'text',text:'Done: 3 wins.'})+line({type:'result',exit_code:0,text:'Done: 3 wins.'});
 assert.deepEqual(hermesTurn(stdout),{reply:'Done: 3 wins.',interim:['Now let me run the backtest.'],error:''});
});

test('a turn without tool calls has no interim message',()=>{
 const stdout=line({type:'text',text:'Hi'})+line({type:'result',exit_code:0,text:'Hi'});
 assert.deepEqual(hermesTurn(stdout).interim,[]);
});

test('output that is not JSONL is the reply as before',()=>{
 assert.deepEqual(hermesTurn('Hello there\n'),{reply:'Hello there',interim:[]});
});

test('a failed run carries the error of its result record',()=>{
 const turn=hermesTurn(line({type:'result',exit_code:1,text:'',error:'no key'}));
 assert.equal(turn.reply,'');assert.equal(turn.error,'no key');
});
