import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createService} from '../server/main.mjs';
import {JUDGE_PROTOCOL} from '../../third-party/addons/godspeed-charm/lib/judge.mjs';
import {addonInvocation} from '../core/native-personal.mjs';
import {wordCheckMs} from '../core/charm-judgement.mjs';

const auditContract=JSON.parse(fs.readFileSync(new URL('../../third-party/addons/godspeed-charm/test/fixtures/audit-log-contract.json',import.meta.url),'utf8'));

// Issue #218: a slip typed in the notebook's chat panel gets the same question the Hermes plugin
// asks. The panel's route is /api/browser-chat -> domains.nativeAgent (a one-shot assistant run that
// does not pass through the plugin), so the notebook asks the judgement itself. The assistant here
// answers in plain words; the godspeed-model stand-in decides what is a slip.
const START=Date.parse('2026-10-21T08:00:00Z');
const VENT='This is useless, you are garbage and wrong again';
const skip=process.platform==='win32';

function setup(t,{judgeSeconds,model=true,answer='Understood.',seedLog}={}){
 process.env.GODSPEED_CHARM_NOW=new Date(START).toISOString();
 if(judgeSeconds)process.env.GODSPEED_CHARM_JUDGE_SECONDS=judgeSeconds;
 t.after(()=>{delete process.env.GODSPEED_CHARM_NOW;delete process.env.GODSPEED_CHARM_JUDGE_SECONDS;});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-charm-panel-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const home=path.join(dir,'home'),root=path.join(dir,'root');fs.mkdirSync(path.join(home,'bin'),{recursive:true});fs.mkdirSync(root);
 if(seedLog){const file=path.join(home,auditContract.relativePath);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,seedLog);}
 const stub=path.join(home,'bin','godspeed-model');
 // Says "slip" for the vent and "unsure" for "hmm", "not" for anything else.
 fs.writeFileSync(stub,`#!${process.execPath}\nlet s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const p=JSON.parse(s).prompt;const v=/useless/.test(p)?'slip':/hmm/.test(p)?'unsure':'not';setTimeout(()=>console.log(JSON.stringify({text:JSON.stringify({verdict:v,language:'en'})})),Number(process.env.STUB_MODEL_MS||0));});\n`,{mode:0o755});
 if(!model)fs.rmSync(stub);
 const spawnProcess=()=>{
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
  child.stdin.on('data',()=>queueMicrotask(()=>{child.stdout.write(answer);child.emit('close',0);}));
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
 return {say,op,s,home};
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

test('the native panel records redacted judgement evidence for a vent and its no',{skip},async t=>{
 const {say,op,home}=await panel(t);
 await op({action:'start',words:'start'});
 await say(VENT);
 await say('no');
 const entries=fs.readFileSync(path.join(home,auditContract.relativePath),'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(entries.length,2);
 for(const entry of entries)assert.deepEqual(Object.keys(entry).sort(),[...auditContract.recordKeys].sort());
 assert.deepEqual(entries.map(({conversation,verdict,source,did})=>({conversation,verdict,source,did})),[
  {conversation:'notebook:browser-owner',verdict:'ask',source:'model',did:'asked'},
  {conversation:'notebook:browser-owner',verdict:'answer',source:'rule',did:'answered no'},
 ]);
 const evidence=JSON.stringify(entries);
 assert.doesNotMatch(evidence,new RegExp(auditContract.redaction.forbiddenText));
 for(const key of auditContract.redaction.forbiddenKeys)assert.ok(!(key in entries[0]));
});

test('the native panel rotates the shared audit log before writing a new redacted record',{skip},async t=>{
 const seed='x'.repeat(auditContract.rotateAfterBytes+1);
 const {say,op,home}=await panel(t,{seedLog:seed});
 await op({action:'start',words:'start'});
 await say(VENT);
 const log=path.join(home,auditContract.relativePath);
 assert.equal(fs.readFileSync(log+'.1','utf8'),seed);
 const entries=fs.readFileSync(log,'utf8').trim().split('\n').map(JSON.parse);
 assert.equal(entries.length,1);
 assert.deepEqual(Object.keys(entries[0]).sort(),[...auditContract.recordKeys].sort());
 assert.doesNotMatch(JSON.stringify(entries),new RegExp(auditContract.redaction.forbiddenText));
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
