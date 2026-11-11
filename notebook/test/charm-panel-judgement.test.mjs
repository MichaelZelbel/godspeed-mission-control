import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {spawnSync} from 'node:child_process';
import {PassThrough} from 'node:stream';
import {createService} from '../server/main.mjs';
import {JUDGE_PROTOCOL} from '../../third-party/addons/godspeed-charm/lib/judge.mjs';
import {addonInvocation} from '../core/native-personal.mjs';
import {wordCheckMs} from '../core/charm-judgement.mjs';

// Issue #218: a slip typed in the notebook's chat panel gets the same question the Hermes plugin
// asks. The panel's route is /api/browser-chat -> domains.nativeAgent, a one-shot assistant run with
// the plugin loaded; the notebook names the turn's conversation (GODSPEED_CHARM_CONVERSATION), so it
// alone judges and records, and a command the model runs lands in the same conversation (#441). The
// assistant here answers in plain words, after running the commands a test gives it; the
// godspeed-model stand-in decides what is a slip.
const START=Date.parse('2026-10-21T08:00:00Z');
const VENT='This is useless, you are garbage and wrong again';
const skip=process.platform==='win32';

function setup(t,{judgeSeconds,model=true,answer='Understood.',turn}={}){
 process.env.GODSPEED_CHARM_NOW=new Date(START).toISOString();
 if(judgeSeconds)process.env.GODSPEED_CHARM_JUDGE_SECONDS=judgeSeconds;
 t.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_CHARM_JUDGE_SECONDS;});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-charm-panel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const home=path.join(dir,'home'),root=path.join(dir,'root');fs.mkdirSync(path.join(home,'bin'),{recursive:true});fs.mkdirSync(root);
 const stub=path.join(home,'bin','godspeed-model');
 // Says "slip" for the vent and "unsure" for "hmm", "not" for anything else.
 fs.writeFileSync(stub,`#!${process.execPath}\nlet s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).prompt;const v=/useless/.test(p)?'slip':/hmm/.test(p)?'unsure':'not';setTimeout(()=>console.log(JSON.stringify({text:JSON.stringify({verdict:v,language:'en'})})),Number(process.env.STUB_MODEL_MS||0));});\n`,{mode:0o755});
 if(!model)fs.rmSync(stub);
 const spawnProcess=(command,args,opts)=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  // A failing check inside the turn fails the turn, so the chat answers with an error, not never.
  child.stdin.on('data',data=>queueMicrotask(()=>{try{turn?.(opts,String(data));}catch(error){child.stderr.write(String(error.stack));child.emit('close',1);return;}child.stdout.write(answer);child.emit('close',0);}));
  return child;
 };
 return {root,home,spawnProcess};
}
async function panel(t,options){
 const {root,home,spawnProcess}=setup(t,options),provider=path.join(root,'provider.json');
 fs.writeFileSync(provider,JSON.stringify({url:'https://openrouter.ai/api/v1/chat/completions',key:'fictional-key',model:'fictional/model'}));
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openai-codex\n  default: fictional-own\n');
 const {nativeAgent}=await import('../core/native-agent.mjs');
 const s=await createService({root,port:0}),base='http://127.0.0.1:'+s.address.port;t.after(()=>s.close());
 s.domains.nativeAgent=nativeAgent({executable:'hermes',home,cwd:root,providerFile:provider,spawnProcess});
 s.query.nativeHermesHome=home;
 // The record orders events by their moment, so each step is a minute after the one before.
 let minute=0;const tick=()=>{process.env.GODSPEED_CHARM_NOW=new Date(START+(++minute)*60000).toISOString();};
 const say=async message=>{tick();const r=await fetch(base+'/api/browser-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message})});assert.equal(r.status,200);return (await r.json()).reply;};
 const op=input=>{tick();return s.domains.invoke('personal-operation',{type:'charm',...input});};
 return {say,op,s};
}

test('five vents in five new panel conversations each end with the question and record asked',{skip},async t=>{
 for(let i=0;i<5;i++){
  const {say,op}=await panel(t);
  assert.equal((await op({action:'start',words:'start the Charm Challenge'})).ok,true);
  const reply=await say(VENT);
  assert.match(reply,/^Understood\.\n\nThat sounded like a slip\. Back to 21\?/,reply);
  const state=(await op({action:'status'})).state;
  assert.deepEqual(state.open.map(q=>q.conversation),['notebook:browser-owner']);
 }
});

test('a yes to the open question records the reset, and a neutral message gets no question',{skip},async t=>{
 const {say,op}=await panel(t);
 await op({action:'start',words:'start'});
 assert.equal(await say('What is the weather like?'),'Understood.');
 assert.equal((await op({action:'status'})).state.open.length,0);
 assert.match(await say(VENT),/Back to 21\?/);
 const answered=await say('yes');
 assert.match(answered,/^Understood\.\n\n/);assert.doesNotMatch(answered,/Back to 21\?/);
 const state=(await op({action:'status'})).state;
 assert.equal(state.open.length,0);assert.equal(state.resetToday,true);
});

test('a no to the open question records kept, not a reset',{skip},async t=>{
 const {say,op}=await panel(t);
 await op({action:'start',words:'start'});
 assert.match(await say(VENT),/Back to 21\?/);
 await say('no');
 const state=(await op({action:'status'})).state;
 assert.equal(state.open.length,0);assert.equal(state.kept,1);assert.equal(state.resetToday,false);
});

test('the verdict words the panel accepts are the plugin\'s',()=>{
 const py=fs.readFileSync(new URL('../../third-party/addons/godspeed-charm/hermes/plugin/godspeed-charm/__init__.py',import.meta.url),'utf8');
 const literal=py.match(/JUDGE_PROTOCOL = (\{.*\})/)[1].replace(/\(/g,'[').replace(/\)/g,']').replace(/,\s*\]/g,']');
 assert.deepEqual(JSON.parse(literal),JUDGE_PROTOCOL);
});

test('a plugin-style judge call carrying a model command is refused on the public path',()=>{
 assert.throws(()=>addonInvocation({root:'.',state:'.',get:()=>null},{addon:'charm',args:['judge','--model-command','/tmp/x']}),/not available/);
});

test('with no challenge running the panel is unchanged',{skip},async t=>{
 const {say,op}=await panel(t);
 assert.equal(await say(VENT),'Understood.');
 assert.equal((await op({action:'status'})).state.running,false);
});

test('without the godspeed-model the word check judges, within the limit',{skip},async t=>{
 const {say,op}=await panel(t,{model:false});
 await op({action:'start',words:'start'});
 assert.match(await say(VENT),/Back to 21\?/);
});

test('a message the model is unsure about gets the question, as in the plugin',{skip},async t=>{
 const {say,op}=await panel(t);
 await op({action:'start',words:'start'});
 assert.match(await say('hmm, well'),/Back to 21\?/);
});

test('a model slower than the limit is not waited for: the word check answers',{skip},async t=>{
 process.env.STUB_MODEL_MS='8000';t.after(()=>{delete process.env.STUB_MODEL_MS;});
 const {say,op}=await panel(t,{judgeSeconds:'1'});
 await op({action:'start',words:'start'});
 const began=Date.now();
 assert.match(await say(VENT),/Back to 21\?/);
 assert.ok(Date.now()-began<6000,'the reply did not wait for the model');
 assert.equal(await say('What is the weather like?'),'Understood.');
});

test('the word check waits five seconds unless GODSPEED_CHARM_PLUGIN_TIMEOUT is a plain positive number',t=>{
 const was=process.env.GODSPEED_CHARM_PLUGIN_TIMEOUT;
 t.after(()=>{if(was===undefined)delete process.env.GODSPEED_CHARM_PLUGIN_TIMEOUT;else process.env.GODSPEED_CHARM_PLUGIN_TIMEOUT=was;});
 const ms=v=>{if(v===undefined)delete process.env.GODSPEED_CHARM_PLUGIN_TIMEOUT;else process.env.GODSPEED_CHARM_PLUGIN_TIMEOUT=v;return wordCheckMs();};
 for(const v of [undefined,'','abc','0','-1'])assert.equal(ms(v),5000,String(v));
 assert.equal(ms('0.5'),500);assert.equal(ms('20'),20000);
});

test('a reply that quotes the question and goes on still ends with the question',{skip},async t=>{
 const question='That sounded like a slip. Back to 21? Yes / No.';
 const {say,op}=await panel(t,{answer:question+' Here is the requested correction.'});
 await op({action:'start',words:'start'});
 const reply=await say(VENT);
 assert.match(reply,/Here is the requested correction\.\n\nThat sounded like a slip\. Back to 21\?[^]*$/);
 assert.equal((await op({action:'status'})).state.open.length,1);
});

// What the model does in a turn: runs the add-on command with the turn's environment and no
// --conversation, as a model typing `godspeed-charm ...` in the terminal would.
const runs=(...args)=>opts=>{const r=spawnSync(process.execPath,[opts.env.GODSPEED_CHARM_SCRIPT,...args,'--json'],{env:{...opts.env,GODSPEED_CHARM_NOW:process.env.GODSPEED_CHARM_NOW},encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
// The turn markers Hermes sessions left in the last minutes (lib/turns.mjs writeTurn).
const markers=(opts,...conversations)=>{const dir=path.join(opts.env.GODSPEED_CHARM_DIR,'.godspeed','charm-turns');fs.mkdirSync(dir,{recursive:true});for(const c of conversations)fs.writeFileSync(path.join(dir,c.replace(/[^A-Za-z0-9_.-]/g,'_')+'.json'),JSON.stringify({conversation:c,when:process.env.GODSPEED_CHARM_NOW})+'\n');};
const events=s=>s.store.list('collection_items').map(i=>i.data).filter(d=>d&&d.kind!=='start').sort((a,b)=>String(a.at).localeCompare(String(b.at)));

for(const [day,fresh] of [['the first day (several fresh markers)',['cli:local-a','cli:local-b','cli:local-c']],['a later day (one fresh marker)',['cli:local-a']]]){
 test(`a vent the model also records itself is one question in this chat, on ${day}`,{skip},async t=>{
  const {say,op,s}=await panel(t,{turn:(opts,input)=>{if(/useless/.test(input)){markers(opts,...fresh);runs('asked','--words',VENT)(opts);}}});
  await op({action:'start',words:'start'});
  const reply=await say(VENT);
  assert.equal(reply.split('Back to 21?').length,2,reply);
  assert.match(reply,/Back to 21\? Yes \/ No\.$/);
  assert.deepEqual(events(s).map(e=>[e.kind,e.conversation]),[['asked','notebook:browser-owner']]);
 });
}

for(const [said,kind,model] of [['yes','reset',true],['yes','reset',false],['no','kept',true],['no','kept',false]]){
 test(`a ${said} answers the vent's question in this chat (${model?'the model records it':'the notebook records it'})`,{skip},async t=>{
  const {say,op,s}=await panel(t,{turn:(opts,input)=>{if(model&&input.startsWith(said)){markers(opts,'cli:local-a');runs('answer',said,'--words',said)(opts);}}});
  await op({action:'start',words:'start'});
  assert.match(await say(VENT),/Back to 21\?/);
  await say(said);
  assert.deepEqual(events(s).map(e=>[e.kind,e.conversation]),[['asked','notebook:browser-owner'],[kind,'notebook:browser-owner']]);
 });
}

test('the assistant turn is told this chat\'s Charm conversation',{skip},async t=>{
 const seen=[];
 const {say}=await panel(t,{turn:opts=>seen.push(opts.env.GODSPEED_CHARM_CONVERSATION)});
 await say('What is the weather like?');
 assert.deepEqual(seen,['notebook:browser-owner']);
});
