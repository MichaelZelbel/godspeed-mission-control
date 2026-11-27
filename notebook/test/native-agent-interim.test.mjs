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

test('JSONL that ends without a result is no reply',()=>{
 const turn=hermesTurn(line({type:'text',text:'Working'})+line({type:'tool_use',name:'terminal'}));
 assert.equal(turn.reply,'');assert.ok(turn.error);
});

test('interim messages are kept before the answer in the chat history and the saved state',async()=>{
 const {default:fs}=await import('node:fs'),{default:os}=await import('node:os'),{default:path}=await import('node:path'),{createService}=await import('../server/main.mjs');
 const s=await createService({root:fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-interim-')),port:0}),base='http://127.0.0.1:'+s.address.port;
 s.domains.nativeAgent=async()=>({reply:'final',interim:['first','second']});
 try{
  const r=await fetch(base+'/api/functions/conversation-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Fictional question'})});
  assert.equal(r.status,200);
  const state=s.store.list('note_conversations')[0].state.messages.map(m=>m.role+':'+m.content);
  assert.deepEqual(state,['user:Fictional question','assistant:first','assistant:second','assistant:final']);
  const saved=s.store.list('conversation_messages').filter(m=>m.role==='assistant').sort((a,b)=>a.created_at.localeCompare(b.created_at)).map(m=>m.content);
  assert.deepEqual(saved,['first','second','final']);
 }finally{await s.close();}
});

test('an assistant that refuses --format is asked again for plain output',async()=>{
 const {nativeAgent}=await import('../core/native-agent.mjs'),{EventEmitter}=await import('node:events'),{PassThrough}=await import('node:stream');
 const seen=[];
 const ask=nativeAgent({executable:'hermes',home:'h',cwd:'w',spawnProcess:(exe,args)=>{
  seen.push(args);const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin.on('data',()=>queueMicrotask(()=>{if(args.includes('--format')){child.stderr.write('error: unrecognized arguments: --format stream-json');child.emit('close',2);}else{child.stdout.write('plain answer');child.emit('close',0);}}));return child;
 }});
 assert.deepEqual(await ask({message:'hi'}),{reply:'plain answer'});
 assert.equal(seen.length,2);assert.equal(seen[1].includes('--format'),false);
});
