import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {installStarter} from '../core/starter-workspace.mjs';
import {backupQuickCommand,readConfigValue} from '../core/hermes-config.mjs';
import {fallbackChain} from '../core/backup-ai.mjs';
import {main as backupCommand,requestBackupChat,REQUEST_FILE,FLOW_STATE,HANDED_OVER} from '../scripts/backup-ai.mjs';
import {TelegramRunner} from '../../docker/full-candidate/telegram-runner.mjs';

// /backupai on the one-click server (22 October 2026, discussion #20): a Hermes quick command that
// needs no AI hands the Telegram chat to the setup helper's backup flow, then the gateway gets it back.
for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];
const kit=fileURLToPath(new URL('../../',import.meta.url));
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const havePython=spawnSync(python,['--version']).status===0;
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-telegram-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const where={node:'/usr/local/bin/node',script:'/opt/godspeed/kit/notebook/scripts/backup-ai.mjs',dir:'/opt/data/full-candidate/telegram'};

test('/backupai is Hermes\' quick command on the one-click server only, and an owner\'s own /backupai stays',()=>{
 const added=backupQuickCommand('model:\n  provider: openai-codex\nquick_commands:\n  radar:\n    type: alias\n    target: "/mc-radar"\n',where);
 assert.equal(readConfigValue(added,['quick_commands','backupai','type']),'exec');
 assert.equal(JSON.parse(readConfigValue(added,['quick_commands','backupai','command'])),"'/usr/local/bin/node' '/opt/godspeed/kit/notebook/scripts/backup-ai.mjs' telegram-request --dir '/opt/data/full-candidate/telegram'");
 assert.equal(readConfigValue(added,['quick_commands','radar','target']),'"/mc-radar"','the other quick commands stay');
 assert.equal(backupQuickCommand(added,where),added,'written once');
 assert.equal(backupQuickCommand('quick_commands: {}\n',where).includes('backupai:'),true);
 // Elsewhere Godspeed's own is taken out, and an owner's own is never touched.
 const removed=backupQuickCommand(added,null);
 assert.equal(readConfigValue(removed,['quick_commands','backupai']),null);assert.equal(readConfigValue(removed,['quick_commands','radar','type']),'alias');
 const owners='quick_commands:\n  backupai:\n    type: exec\n    command: my-own-backup-script\n';
 assert.equal(backupQuickCommand(owners,where),owners);assert.equal(backupQuickCommand(owners,null),owners);
});

test('wiring the server\'s assistant adds /backupai and tells the context plugin; a computer gets neither',t=>{
 const base=temporary(t),root=path.join(base,'workspace'),home=path.join(base,'hermes'),dir=path.join(base,'telegram');
 fs.mkdirSync(root,{recursive:true});fs.mkdirSync(home,{recursive:true});installStarter(root);
 const wire=extra=>execFileSync(process.execPath,[path.join(kit,'notebook','scripts','wire-assistant.mjs'),home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41991',GODSPEED_DEVICE:'local',...extra},windowsHide:true});
 const marker=path.join(home,'plugins','godspeed-context','backup-command.txt'),config=()=>fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 wire({GODSPEED_ORIGINAL_RUNTIME:'on',GODSPEED_TELEGRAM_DIR:dir,GODSPEED_TELEGRAM:'web'});
 assert.match(JSON.parse(readConfigValue(config(),['quick_commands','backupai','command'])),/backup-ai\.mjs' telegram-request --dir '/);
 assert.equal(fs.readFileSync(marker,'utf8').trim(),'/backupai');
 // The development server's own bot from the environment has no runner to hand the chat to.
 wire({GODSPEED_ORIGINAL_RUNTIME:'on',GODSPEED_TELEGRAM_DIR:dir,GODSPEED_TELEGRAM:'on'});
 assert.equal(readConfigValue(config(),['quick_commands','backupai']),null);assert.equal(fs.existsSync(marker),false);
});

test('/backupai leaves one request for the runner, and a new one once that chat is done',t=>{
 const dir=temporary(t),now=new Date('2026-10-22T10:00:00Z');
 const first=requestBackupChat(dir,now);
 assert.match(first.id,/^[0-9a-f]{16}$/);assert.equal(first.at,now.toISOString());
 assert.deepEqual(requestBackupChat(dir,new Date(now.getTime()+60000)),first,'pressed twice: one chat');
 fs.writeFileSync(path.join(dir,FLOW_STATE),JSON.stringify({request:first.id,done:true}));
 const second=requestBackupChat(dir,new Date(now.getTime()+120000));assert.notEqual(second.id,first.id);
 const late=requestBackupChat(dir,new Date(now.getTime()+120000+31*60000));assert.notEqual(late.id,second.id,'an old request is not reused');
});

test('the command behind /backupai answers at once and the chat helper\'s commands keep keys out of what they print',async t=>{
 const base=temporary(t),root=path.join(base,'workspace'),home=path.join(base,'hermes'),dir=path.join(base,'telegram');
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.mkdirSync(home,{recursive:true});
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  provider: openai-codex\n  default: gpt-fictional\n');
 let out='';const write=text=>{out+=text;};const env={GODSPEED_WORKSPACE:root,HERMES_HOME:home};
 assert.equal(await backupCommand(['telegram-request','--dir',dir],{env,write}),0);
 assert.equal(out.trim(),HANDED_OVER);assert.ok(fs.existsSync(path.join(dir,REQUEST_FILE)));
 assert.ok(!/—/.test(HANDED_OVER));
 out='';await backupCommand(['show'],{env,write});
 assert.deepEqual(JSON.parse(out),{main:{provider:'openai-codex',model:'gpt-fictional'},configured:false,backup:null,more:0,usage:{answers:0,last_answer_at:null,main_failing_since:null,last_main_error:null},check:null});
 out='';await backupCommand(['set'],{env,write,read:async()=>JSON.stringify({provider:'anthropic',model:'claude-fictional',api_key:'sk-ant-fictional-test-key'})});
 assert.ok(!out.includes('sk-ant'),'the key is never printed');assert.equal(JSON.parse(out).backup.via,'telegram');
 assert.deepEqual(fallbackChain(fs.readFileSync(path.join(home,'config.yaml'),'utf8')),[{provider:'anthropic',model:'claude-fictional',key:true}]);
 await assert.rejects(backupCommand(['set'],{env,write,read:async()=>JSON.stringify({provider:'x',model:'y',program:'rm -rf'})}),/provider and model/);
 // The check asks the backup alone through the helper; an entry on standard input is tried before it is saved.
 fs.writeFileSync(path.join(root,'.godspeed','assistant.json'),JSON.stringify({verified:true,executable:path.join(base,'runtime','hermes'),home,sourceRoot:path.join(base,'runtime')}));
 fs.mkdirSync(path.join(base,'runtime'));fs.writeFileSync(path.join(base,'runtime','hermes'),'');fs.writeFileSync(path.join(base,'runtime','python3'),'');
 const sent=[];const spawnProcess=(reply,code=0)=>()=>{const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();let input='';child.stdin.on('data',d=>input+=d);child.stdin.on('finish',()=>{sent.push(JSON.parse(input));setImmediate(()=>{child.stdout.end(JSON.stringify(reply));setTimeout(()=>child.emit('close',code),5);});});return child;};
 out='';const trial={provider:'openrouter',model:'trial/model',api_key:'sk-or-trial-test-key'};
 assert.equal(await backupCommand(['check'],{env,write,read:async()=>JSON.stringify(trial),spawnProcess:spawnProcess({text:'ready',provider:'openrouter',model:'trial/model',backup:true})}),0);
 assert.deepEqual(JSON.parse(out),{ok:true,provider:'openrouter',model:'trial/model'});
 assert.deepEqual({route:sent[0].route,entry:sent[0].entry},{route:'backup',entry:trial});
 out='';assert.equal(await backupCommand(['check'],{env,write,read:async()=>'',spawnProcess:spawnProcess({error:'x',reason:'sign-in'},1)}),1);
 assert.deepEqual(JSON.parse(out),{ok:false,error:'The AI account needs to be signed in again, or its key was refused.'});
 assert.equal(sent[1].entry,undefined,'without an entry the saved backup is asked');
 out='';await backupCommand(['remove'],{env,write});assert.deepEqual(JSON.parse(out),{removed:true,configured:false});
});

test('the assistant hears where a backup AI is connected on this installation, and only when asked',{skip:!havePython&&'no Python here'},()=>{
 const plugin=path.join(kit,'notebook','assistant-files','godspeed-context','__init__.py');
 const lines=execFileSync(python,['-c',`import importlib.util,json,sys
spec=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
asks=["Can you connect a backup AI?","Ich will eine Ersatz-KI","set a fallback model please","what's the weather?",[{"type":"text","text":"second AI for when ChatGPT is down"}]]
print(json.dumps([m.backup_block(a,"/backupai") for a in asks]))
print(json.dumps(m.backup_block("backup ai", None)))`,plugin],{encoding:'utf8'}).trim().split('\n');
 const [server,computer]=lines.map(l=>JSON.parse(l));
 const [english,german,fallback,weather,parts]=server;
 for(const block of [english,german,fallback,parts])assert.match(block,/^\[godspeed-backup-ai\] .*send \/backupai here in Telegram/);
 assert.equal(weather,null);
 assert.match(english,/Never ask for an API key in this chat/);
 assert.match(computer,/Settings, Your AI, Backup AI/);assert.doesNotMatch(computer,/backupai/);
 for(const block of [english,computer])assert.ok(!/—/.test(block));
});

// THE RUNNER (docker/full-candidate/telegram-runner.mjs): the gateway steps aside for the backup chat
// a few seconds after /backupai, and takes the bot back when that chat is done or too old.
function runner(t){
 const dir=temporary(t);let clock=Date.parse('2026-10-22T10:00:00Z'),pid=0;const started=[],signals=[];
 const r=new TelegramRunner({dir,env:{PATH:'/usr/bin',HOME:'/fictional',GODSPEED_WORKSPACE:'/fictional/workspace'},now:()=>clock,python:'/fictional/python3',hermes:'/fictional/hermes',
  address:()=>({link:null}),setup:'/kit/godspeed-telegram-setup',finish:'/kit/telegram-setup-finish.mjs',backup:'/kit/backup-ai.mjs',
  spawnProcess:(command,args,options)=>{const child=new EventEmitter();child.pid=++pid;child.kill=()=>{};Object.assign(child,{command,args,options});started.push(child);return child;},
  kill:(id,signal)=>{signals.push([id,signal]);const child=started.find(c=>c.pid===id);setImmediate(()=>child.emit('exit',null));}});
 const write=(name,value)=>fs.writeFileSync(path.join(dir,name),JSON.stringify(value));
 write('connection.json',{token:'123456789:AAHfictionalKeyForTestsOnly_0123456789',bot_id:4242,start_code:'fictionalStartCode0123456789abcd'});
 write('setup.json',{bot_id:4242,owner_id:111,chat_id:111,owner_name:'Anna',done:true});
 return {dir,r,started,signals,write,advance:ms=>{clock+=ms;},now:()=>new Date(clock)};
}
const tick=async r=>{r.tick();await new Promise(resolve=>setImmediate(resolve));};
test('the gateway hands the bot to the backup chat after /backupai, and gets it back when the chat is done',async t=>{
 const f=runner(t);
 await tick(f.r);assert.deepEqual(f.started[0].args,['gateway','run']);
 const request=requestBackupChat(f.dir,f.now());
 await tick(f.r);assert.equal(f.signals.length,0,'a few seconds for the gateway to send its one moment');
 f.advance(4000);await tick(f.r);assert.deepEqual(f.signals,[[1,'SIGTERM']]);await tick(f.r);
 const chat=f.started[1];
 assert.deepEqual([chat.command,chat.args],['/fictional/python3',['/kit/godspeed-telegram-setup']]);
 const env=chat.options.env;
 assert.equal(env.GODSPEED_TG_FLOW,'backup');assert.equal(env.GODSPEED_TG_REQUEST,request.id);
 assert.deepEqual([env.GODSPEED_TG_OWNER_ID,env.GODSPEED_TG_CHAT_ID,env.GODSPEED_TG_OWNER_NAME],['111','111','Anna']);
 assert.equal(env.GODSPEED_TG_STATE,path.join(f.dir,FLOW_STATE));assert.match(env.GODSPEED_TG_BACKUP,/"\/kit\/backup-ai\.mjs"$/);
 assert.equal(env.GODSPEED_TELEGRAM_START_CODE,undefined,'the owner is known; nobody can take the bot here');
 assert.equal(env.TELEGRAM_BOT_TOKEN,undefined,'Hermes does not read the bot meanwhile');
 f.write(FLOW_STATE,{request:request.id,done:true});chat.emit('exit',0);await tick(f.r);
 assert.deepEqual(f.started[2].args,['gateway','run'],'the gateway takes the bot back at once');
});
test('a backup chat that never finishes keeps the assistant away for half an hour at most',async t=>{
 const f=runner(t);await tick(f.r);
 requestBackupChat(f.dir,f.now());f.advance(5000);await tick(f.r);await tick(f.r);
 assert.equal(f.started[1].options.env.GODSPEED_TG_FLOW,'backup');
 f.advance(30*60000);await tick(f.r);await tick(f.r);
 assert.deepEqual(f.started.at(-1).args,['gateway','run']);
});
