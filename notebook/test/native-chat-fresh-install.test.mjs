// Issue #127: on a fresh install the notebook's chat answered "start the Charm Challenge" (and every
// other first message) with "The AI request failed". The scenario had connected the AI the way
// Settings does without ticking "Use it for the routines too", so the assistant's home named no model,
// and the chat then asked the assistant for the Settings model with --model and --provider next to
// --continue. The assistant freezes a named conversation's model when it makes it and refuses a
// different one on resume ("creation overrides are unsupported on resume"), so the answer was
// always the generic sentence. The fake assistant below keeps that rule, as the real one (Hermes
// v0.22.5, hermes_cli/gateway_chat.py check_resume_policy) does.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {nativeAgent,homeHasModel} from '../core/native-agent.mjs';
import {createService} from '../server/main.mjs';
import {KEPT_FILE,keepAiFailure} from '../core/ai-failures.mjs';
import {hermesFailureMessage} from '../core/runtime.mjs';

const KEY='fictional-key-4711';
const REFUSAL="Error: Resume retains gateway session policy; creation overrides are unsupported on resume. -m/--model, --provider differ from this session's launch: resume without them and use /model after resuming to switch.";

// The assistant, as far as the chat meets it: it answers with the model its home's config.yaml names,
// refuses model flags on a named conversation, and says what went wrong the way it does.
function fakeAssistant(home,{failWith}={}){
  const calls=[];
  const spawnProcess=(exe,args,options)=>{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.stdin.on('data',data=>queueMicrotask(()=>{
      calls.push({args,env:options.env,message:String(data)});
      const config=(()=>{try{return fs.readFileSync(path.join(home,'config.yaml'),'utf8');}catch{return '';}})();
      const model=/^[ \t]+default:[ \t]*"?([^"\n]+)"?/m.exec(config)?.[1];
      const flags=args.filter(a=>['--model','--provider','--base-url'].includes(a));
      if(failWith){child.stderr.write(failWith);child.emit('close',1);return;}
      if(args.includes('--continue')&&flags.length){child.stderr.write(REFUSAL+'\n');child.emit('close',2);return;}
      if(!model&&!flags.length){child.stderr.write('No model is configured.\n');child.emit('close',1);return;}
      child.stdout.write('Charm Challenge started. Answered by '+(model||'?')+'.');child.emit('close',0);
    }));
    return child;
  };
  return {calls,spawnProcess};
}
const folder=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-fresh-chat-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const connect=(dir,extra={})=>{const file=path.join(dir,'provider.json');fs.writeFileSync(file,JSON.stringify({url:'https://openrouter.ai/api/v1/chat/completions',key:KEY,model:'fictional/model',...extra}));return file;};

test('a fresh install, whose assistant home names no model, answers the first message and the next',async t=>{
  const dir=folder(t),home=path.join(dir,'home');fs.mkdirSync(home);
  const providerFile=connect(dir),{calls,spawnProcess}=fakeAssistant(home);
  assert.equal(homeHasModel(home),false);
  const ask=nativeAgent({executable:'hermes',home,cwd:dir,providerFile,spawnProcess,keptFile:path.join(dir,KEPT_FILE)});
  const first=await ask({message:'start the Charm Challenge',conversation_id:'browser-owner'});
  assert.equal(first.reply,'Charm Challenge started. Answered by fictional/model.');
  const second=await ask({message:'how is my Charm Challenge?',conversation_id:'browser-owner'});
  assert.match(second.reply,/Answered by fictional\/model/);
  for(const call of calls){
    for(const flag of ['--model','--provider','--base-url'])assert.equal(call.args.includes(flag),false,flag+' next to --continue is refused by the assistant');
    assert.equal(call.env.OPENAI_API_KEY,undefined);
  }
  assert.equal(homeHasModel(home),true,'the model Settings connected is now the home\'s own');
  assert.equal(fs.existsSync(path.join(dir,KEPT_FILE)),false,'nothing failed, so nothing is kept');
});

test('a home that already has a model of its own is left alone',async t=>{
  const dir=folder(t),home=path.join(dir,'home');fs.mkdirSync(home);
  const own='model:\n  provider: openai-codex\n  default: fictional-own\n';fs.writeFileSync(path.join(home,'config.yaml'),own);
  const {spawnProcess}=fakeAssistant(home),ask=nativeAgent({executable:'hermes',home,cwd:dir,providerFile:connect(dir),spawnProcess});
  assert.match((await ask({message:'hello',conversation_id:'browser-owner'})).reply,/Answered by fictional-own/);
  assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),own);
});

test('through the notebook\'s own chat door the first message gets the assistant\'s answer, not the generic failure',async t=>{
  const dir=folder(t),home=path.join(dir,'home'),root=path.join(dir,'root');fs.mkdirSync(home);fs.mkdirSync(root);
  const s=await createService({root,port:0}),base='http://127.0.0.1:'+s.address.port;
  try{
    const {spawnProcess}=fakeAssistant(home);
    s.domains.nativeAgent=nativeAgent({executable:'hermes',home,cwd:root,providerFile:connect(root),spawnProcess});
    const answer=await fetch(base+'/api/browser-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'start the Charm Challenge',request_id:'fictional-first'})});
    assert.equal(answer.status,200);
    assert.match((await answer.json()).reply,/^Charm Challenge started\./);
  }finally{await s.close();}
});

test('a failed AI request tells the reader what to do, and the notebook keeps the diagnosis without any key',async t=>{
  const dir=folder(t),home=path.join(dir,'home'),kept=path.join(dir,KEPT_FILE);fs.mkdirSync(home);
  const failure='Traceback (most recent call last):\n  File "run_agent.py", line 88\nOPENAI_API_KEY='+KEY+'\nopenai.BadRequestError: Error code: 400 - {"error":{"message":"No endpoints found for fictional/model","code":400}} for '+KEY+'\n';
  const {spawnProcess}=fakeAssistant(home,{failWith:failure});
  const ask=nativeAgent({executable:'hermes',home,cwd:dir,providerFile:connect(dir),spawnProcess,keptFile:kept});
  const error=await ask({message:'start the Charm Challenge',conversation_id:'browser-owner'}).then(()=>null,e=>e);
  assert.ok(error,'the failure reaches the caller');
  assert.match(error.message,/^The AI request failed \(.*No endpoints found for fictional\/model.*\)\. Check the AI connection in Settings, then try again\.$/);
  assert.doesNotMatch(error.message,/Traceback|run_agent|private runtime diagnostics/);
  assert.equal(error.message.includes(KEY),false);
  const text=fs.readFileSync(kept,'utf8'),entry=JSON.parse(text.trim().split('\n').at(-1));
  assert.equal(text.includes(KEY),false,'the kept diagnosis holds no key');
  assert.match(entry.diagnosis,/Traceback/);assert.match(entry.diagnosis,/No endpoints found/);
  assert.equal(entry.exit_code,1);assert.equal(entry.model,'fictional/model');assert.ok(entry.at);
  if(process.platform!=='win32')assert.equal(fs.statSync(kept).mode&0o077,0,'private to this account');
});

test('through the chat door a failure is a plain sentence with a next step, never only that the request failed',async t=>{
  const dir=folder(t),home=path.join(dir,'home'),root=path.join(dir,'root');fs.mkdirSync(home);fs.mkdirSync(root);
  const s=await createService({root,port:0}),base='http://127.0.0.1:'+s.address.port;
  try{
    const {spawnProcess}=fakeAssistant(home,{failWith:'something broke inside\n'});
    s.domains.nativeAgent=nativeAgent({executable:'hermes',home,cwd:root,providerFile:connect(root),spawnProcess});
    const answer=await fetch(base+'/api/browser-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'hello',request_id:'fictional-failing'})});
    assert.equal(answer.status,400);
    const {error}=await answer.json();
    assert.match(error,/Check the AI connection in Settings, then try again\.$/);
    assert.doesNotMatch(error,/something broke inside|retained for investigation/);
  }finally{await s.close();}
});

test('the generic failure sentence names Settings and trying again; the specific ones stay as they were',()=>{
  const generic=hermesFailureMessage('boom');
  assert.equal(generic,'The AI request failed. Check the AI connection in Settings, then try again.');
  assert.match(hermesFailureMessage('quota exceeded'),/usage limit/);
  assert.match(hermesFailureMessage('Error 401 unauthorized'),/needs sign-in/);
  assert.match(hermesFailureMessage('context length exceeded'),/context limit/);
  // A key the caller knows is taken out even where no pattern would catch it.
  assert.equal(hermesFailureMessage('HTTP 400 for account plain-secret',['plain-secret']).includes('plain-secret'),false);
});

test('the kept diagnosis keeps only the newest entries and never fails the chat',t=>{
  const dir=folder(t),file=path.join(dir,'sub','kept.log');
  for(let i=0;i<60;i++)assert.equal(keepAiFailure({file,diagnostic:'failure number '+i,said:'x'}),true);
  const lines=fs.readFileSync(file,'utf8').trim().split('\n');
  assert.equal(lines.length,40);assert.match(lines.at(-1),/failure number 59/);assert.match(lines[0],/failure number 20/);
  assert.equal(keepAiFailure({file:undefined,diagnostic:'x'}),false);
  assert.equal(keepAiFailure({file:dir,diagnostic:'x'}),false,'a file that cannot be written is not an error');
});
