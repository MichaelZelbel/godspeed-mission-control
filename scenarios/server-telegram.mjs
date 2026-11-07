#!/usr/bin/env node
// Drive Telegram from outside an installed Docker server.  The only substitute is the Bot API
// process started in that server; all setup, gateway, and assistant work remains in the image.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const [, , command, ...args] = process.argv;
const option = name => {
  const at=args.indexOf(name);
  if(at<0 || !args[at+1]) throw Error(`server-telegram: ${name} is required`);
  return args[at+1];
};
const optional = name => {
  const at=args.indexOf(name);
  return at < 0 ? undefined : args[at+1];
};
const server=optional('--server') ?? 'godspeed';
const evidence=optional('--evidence');
const token=optional('--token');
const owner=Number(optional('--owner') ?? '31415');
const notebookPort=optional('--notebook-port') ?? '47832';
const docker=(arguments_,input) => execFileSync('sudo',['docker',...arguments_],{input,encoding:'utf8',stdio:['pipe','pipe','pipe']});
const inServer=(arguments_,input) => docker(['exec','-i',server,...arguments_],input);
const sleep=ms => new Promise(resolve=>setTimeout(resolve,ms));
const json=value => JSON.stringify(value);
const write=(file,value) => fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=file => JSON.parse(fs.readFileSync(file,'utf8'));

function requireEvidence(){
  if(!evidence) throw Error('server-telegram: --evidence is required');
  fs.mkdirSync(evidence,{recursive:true,mode:0o700});
}
function stateFile(){ return path.join(evidence,'telegram-run.json'); }
function fakeRecord(){ return path.join(evidence,'telegram-requests.json'); }
function copyRecord(){
  try { fs.writeFileSync(fakeRecord(),inServer(['cat','/tmp/godspeed-scenario-telegram-record.json']),{mode:0o600}); }
  catch { throw Error('the installed fake Telegram API wrote no request record'); }
  return read(fakeRecord());
}
function runner(){
  try { fs.writeFileSync(path.join(evidence,'runner.json'),inServer(['cat','/opt/data/full-candidate/telegram/runner.json']),{mode:0o600}); }
  catch { throw Error('the installed Telegram runner wrote no runner.json'); }
  return read(path.join(evidence,'runner.json'));
}
function loadState(){
  try { return read(stateFile()); }
  catch { return {steps:[],outbox:[],sent:0}; }
}
function saveState(value){ write(stateFile(),value); write(path.join(evidence,'run.json'),{steps:value.steps,outbox:value.outbox,sent:value.sent}); }
export function captureSent(state,record,label,before=state.sent){
  for(const sent of (record.sent ?? []).slice(before)) state.outbox.push({label,kind:'sendMessage',chat_id:sent.chat_id,text:sent.text,buttons:(sent.buttons ?? []).map(button=>button.callback),accepted:true});
  state.sent=(record.sent ?? []).length;
}
async function capture(label,kind,action){
  const state=loadState();
  try {
    const started=copyRecord(), requestStart=(started.requests ?? []).length;
    const unattributed=(started.sent ?? []).length-state.sent;
    if(unattributed>0) throw Error(`the installed Telegram sent ${unattributed} message(s) that no step accounts for before ${label}`);
    action();
    // A reply is a new message to the owner after this action began; a button press may instead edit its message.
    const answered=record=>(record.sent ?? []).slice(state.sent).some(message=>message.chat_id===owner)
      || (kind==='press' && (record.edits ?? []).length>(started.edits ?? []).length);
    await waitFor('reply to the owner',copyRecord,answered,30);
    const record=copyRecord();
    captureSent(state,record,label);
    state.steps.push({label,kind,success:true,request_start:requestStart,request_end:(record.requests ?? []).length});
    saveState(state);
  } catch(error) {
    state.steps.push({label,kind,success:false,error:String(error.message ?? error)});
    saveState(state);
    throw error;
  }
}
function act(value){
  const request=Buffer.from(json(value));
  inServer(['curl','-fsS','--max-time','30','-X','POST','-H','Content-Type: application/json','--data-binary','@-','http://127.0.0.1:8081/__act'],request);
}
function post(pathname,body){
  const result=inServer(['curl','-fsS','--max-time','300','-X','POST','-H','Content-Type: application/json','--data-binary','@-',`http://127.0.0.1:${notebookPort}${pathname}`],Buffer.from(json(body)));
  return JSON.parse(result);
}
async function waitFor(description,readValue,predicate,seconds=90){
  const end=Date.now()+seconds*1000;
  while(Date.now()<end){
    try { const value=readValue(); if(predicate(value)) return value; } catch {}
    await sleep(1000);
  }
  throw Error(`the installed Telegram ${description} did not appear within ${seconds} seconds`);
}

// The setup chat answers one owner action in several messages; the ones a wait lets pass belong to the step before it.
function attributeSent(label){
  const state=loadState();
  captureSent(state,copyRecord(),label);
  saveState(state);
}

async function setup(){
  requireEvidence();
  if(!token) throw Error('server-telegram: --token is required for setup');
  const withoutAI=args.includes('--without-ai');
  const scenario={users:{[owner]:{first_name:'Scenario owner',username:'scenario_owner'}},start:[],rules:[]};
  const scenarioFile=path.join(evidence,'telegram-scenario.json');
  write(scenarioFile,scenario);
  docker(['cp',scenarioFile,`${server}:/tmp/godspeed-scenario-telegram.json`]);
  // It is deliberately the stage image's copy, just as the full-candidate proof does.
  inServer(['sh','-c','pkill -f godspeed-scenario-telegram.py 2>/dev/null || true']);
  inServer(['cp','/opt/godspeed/kit/docker/test/fake-telegram.py','/tmp/godspeed-scenario-telegram.py']);
  inServer(['sh','-c',`python3 /tmp/godspeed-scenario-telegram.py --port 8081 --token ${JSON.stringify(token)} --scenario /tmp/godspeed-scenario-telegram.json --record /tmp/godspeed-scenario-telegram-record.json >/tmp/godspeed-scenario-telegram.log 2>&1 &`]);
  await waitFor('API',copyRecord,record=>Array.isArray(record.requests),15);
  const connected=post('/api/telegram/connect',{token,timezone:'Etc/UTC',address:'https://example.invalid'});
  if(!connected?.start_message) throw Error('Settings connected the bot but supplied no one-time /start message');
  await capture('setup-start','setup',()=>act({from:owner,text:connected.start_message}));
  if(!withoutAI){
    await waitFor('setup question',copyRecord,record=>(record.sent ?? []).some(message=>(message.buttons ?? []).some(button=>button.callback==='anthropic')));
    attributeSent('setup-start');
    await capture('setup-provider','press',()=>act({from:owner,press:'anthropic'}));
    const key=optional('--ai-key');
    if(!key) throw Error('server-telegram: --ai-key is required because the setup path checks the dedicated AI account');
    await capture('setup-key','say',()=>act({from:owner,text:key}));
  }
  await waitFor('first-install question',copyRecord,record=>(record.sent ?? []).some(message=>(message.buttons ?? []).some(button=>button.callback==='have:no')),180);
  attributeSent(withoutAI ? 'setup-start' : 'setup-key');
  await capture('setup-first-install','press',()=>act({from:owner,press:'have:no'}));
  await waitFor('gateway handoff',runner,value=>value.state==='gateway',180);
  const setupState=JSON.parse(inServer(['cat','/opt/data/full-candidate/telegram/setup.json']));
  if(!setupState.done) throw Error('the Telegram setup ended without marking its handoff done');
  const handoff=copyRecord();
  const state=loadState();
  state.sent=(handoff.sent ?? []).length;
  saveState(state);
  runner();
}

async function say(){
  requireEvidence();
  const label=option('--label'), text=option('--text');
  await capture(label,'say',()=>act({from:owner,text}));
}
export function callbackData(record,owner,question,label){
 const message=[...(record.sent??[])].reverse().find(sent=>sent.chat_id===owner&&String(sent.text??'').toLowerCase().includes(question.toLowerCase())&&Array.isArray(sent.buttons)&&sent.buttons.some(button=>button.label===label));
 if(!message)throw Error(`the installed Telegram question ${JSON.stringify(question)} has no ${JSON.stringify(label)} button`);
 const callback=message.buttons.find(button=>button.label===label).callback;
 if(typeof callback!=='string'||!callback)throw Error(`the installed Telegram ${JSON.stringify(label)} button has no callback data`);
 return callback;
}
async function press(){
  requireEvidence();
  const label=option('--label'), question=option('--question'), button=option('--button');
  await capture(label,'press',()=>act({from:owner,press:callbackData(copyRecord(),owner,question,button)}));
}
async function snapshot(){
  requireEvidence();
  const record=copyRecord(); runner();
  const state=loadState();
  captureSent(state,record,'snapshot',state.sent);
  const trailing=state.outbox.filter(message=>message.label==='snapshot'&&message.chat_id===owner).length;
  if(trailing>0) {
    const error=`the installed Telegram sent ${trailing} message(s) after the last step`;
    state.steps.push({label:'snapshot',kind:'snapshot',success:false,error});
    saveState(state);
    throw Error(error);
  }
  saveState(state);
}
async function mark(){
  requireEvidence();
  const label=option('--label'), kind=optional('--kind') ?? 'run';
  const state=loadState(), record=copyRecord(), start=state.sent;
  captureSent(state,record,label,start);
  state.steps.push({label,kind,success:true,request_end:(record.requests ?? []).length});
  saveState(state);
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    if(command==='setup') await setup();
    else if(command==='say') await say();
    else if(command==='press') await press();
    else if(command==='snapshot') await snapshot();
    else if(command==='mark') await mark();
    else throw Error('usage: server-telegram.mjs <setup|say|press|snapshot> --server NAME --evidence DIR [...]');
  } catch(error) {
    process.stderr.write(`server-telegram: ${error.message}\n`);
    process.exitCode=1;
  }
}
