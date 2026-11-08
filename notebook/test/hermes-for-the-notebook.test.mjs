import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {execFileSync,spawnSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {NativeScheduler} from '../core/native-scheduler.mjs';import {runChild} from '../core/child-process.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {SCRIPT_TIMEOUT_SECONDS,COMPRESSION_THRESHOLD_TOKENS,godspeedHermesSettings,setConfigValue,readConfigValue,configList,CRON_PROVIDER} from '../core/hermes-config.mjs';

// What a live run of the book's prompts found on 9 October 2026 (a scratch Windows install, free
// models, the notebook's own chat), each a thing any model would hit:
//   Hermes' own memory acted as a second store (memory_enabled: false leaves its user profile on),
//   the assistant's questions went to Hermes' clarify tool, which nobody can answer in the
//   notebook's one-turn chat, the notebook's tools sat behind Hermes' tool search and "did not
//   exist" when called by name, and Hermes' cronjob tool said routines "will NOT fire until the
//   gateway is started" although the notebook ticks them.
const temporary=(t,name)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-'+name+'-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};

// The configuration ensure-hermes-full-alpha.ps1 and wire-assistant.mjs wrote for the live run, word for word.
const LIVE='terminal:\n  cwd: "C:\\\\run\\\\ws"\nskills:\n  external_dirs: ["C:\\\\run\\\\ws\\\\skills"]\nmemory:\n  memory_enabled: false\n\nplugins:\n  enabled: ["godspeed-coach", "godspeed-journal", "godspeed-headache"]\n\nmcp_servers:\n  notebook:\n    url: http://127.0.0.1:47951/mcp\nmodel:\n  provider: openrouter\n  default: "thinkingmachines/inkling:free"\ntimezone: "Europe/Berlin"\n';

test('Hermes is set up for the notebook: one memory, no clarify, the notebook\'s tools direct, a scheduler it knows runs',()=>{
 const out=godspeedHermesSettings(LIVE);
 assert.equal(readConfigValue(out,['memory','memory_enabled']),'false');
 assert.equal(readConfigValue(out,['memory','user_profile_enabled']),'false','the user profile is the memory the live run wrote to');
 assert.deepEqual(configList(readConfigValue(out,['agent','disabled_toolsets'])),['clarify','memory']);
 assert.equal(readConfigValue(out,['tools','tool_search','enabled']),'"off"');
 assert.equal(readConfigValue(out,['cron','provider']),CRON_PROVIDER);
 // Everything else stays as it was, and a second wiring changes nothing.
 for(const line of LIVE.split('\n').filter(Boolean))assert.ok(out.includes(line),line);
 assert.equal(godspeedHermesSettings(out),out);
});

test('the settings join a configuration Hermes itself wrote, and keep what the owner chose',()=>{
 // Hermes writes lists with their items at the key's own level.
 const hermes='agent:\n  disabled_toolsets:\n  - browser\n  max_turns: 60\nmemory:\n  memory_enabled: true\n  user_profile_enabled: true\n  memory_char_limit: 2200\ntools:\n  tool_search:\n    enabled: auto\n    threshold_pct: 5\n  connectors:\n    enabled: true\ncron:\n  provider: \'\'\n# the owner\'s note\n';
 const out=godspeedHermesSettings(hermes);
 assert.deepEqual(configList(readConfigValue(out,['agent','disabled_toolsets'])),['browser','clarify','memory'],'a toolset the owner switched off stays off');
 assert.equal(readConfigValue(out,['agent','max_turns']),'60');
 assert.equal(readConfigValue(out,['memory','memory_char_limit']),'2200');
 assert.equal(readConfigValue(out,['tools','tool_search','threshold_pct']),'5');
 assert.equal(readConfigValue(out,['tools','connectors','enabled']),'true');
 assert.equal(readConfigValue(out,['tools','tool_search','enabled']),'"off"');
 assert.match(out,/# the owner's note\n$/);
 assert.equal(godspeedHermesSettings(out),out);
 // "hermes config set" stores a list as a JSON string; an empty section is written out.
 assert.deepEqual(configList(readConfigValue(godspeedHermesSettings('agent:\n  disabled_toolsets: "[\'memory\']"\n'),['agent','disabled_toolsets'])),['memory','clarify']);
 assert.equal(readConfigValue(godspeedHermesSettings('agent: {}\n'),['agent','disabled_toolsets']),'["clarify", "memory"]');
 assert.equal(readConfigValue(godspeedHermesSettings(''),['cron','provider']),CRON_PROVIDER);
 // A nested key that is missing goes at the end of its own section.
 assert.equal(setConfigValue('a:\n  b: 1\nc: 2\n',['a','d'],'3'),'a:\n  b: 1\n  d: 3\nc: 2\n');
});

// THE CHAT ANSWERS AT ONCE AND SAYS NOTHING ELSE (25 and 26 October 2026, by hand on the
// maintainer's server, then here for everyone). A fresh Hermes config.yaml, as Hermes 0.21.2 writes
// it: streaming.enabled: false, no display.platforms section at all, interim_assistant_messages and
// long_running_notifications at the display level, which a per-platform value beats, and a
// compression section without threshold_tokens. display.streaming is Hermes' setting for its own
// terminal, not for a chat, and is none of Godspeed's business.
const HERMES_DEFAULTS='compression:\n  enabled: true\n  threshold: 0.5\n  target_ratio: 0.2\ndisplay:\n  compact: false\n  streaming: false\n  interim_assistant_messages: true\n  tool_progress: all\n  long_running_notifications: true\n  tool_progress_overrides: {}\nstreaming:\n  enabled: false\n  transport: auto\n_config_version: 44\n';
const chatSettings=text=>{const out=godspeedHermesSettings(text);return {
 streaming:readConfigValue(out,['streaming','enabled']),
 draft:readConfigValue(out,['display','platforms','telegram','streaming']),
 interim:readConfigValue(out,['display','platforms','telegram','interim_assistant_messages']),
 heartbeat:readConfigValue(out,['display','platforms','telegram','long_running_notifications']),
 summarise:readConfigValue(out,['compression','threshold_tokens']),
};};
const FAST_CHAT={streaming:'true',draft:'true',interim:'false',heartbeat:'false',summarise:String(COMPRESSION_THRESHOLD_TOKENS)};

test('the chat shows the answer as it is written, leaves no "let me check" behind, and summarises before a message waits',()=>{
 assert.equal(COMPRESSION_THRESHOLD_TOKENS,100000);
 // A settings text without these keys gets all of them.
 assert.deepEqual(chatSettings(''),FAST_CHAT);
 assert.deepEqual(chatSettings(LIVE),FAST_CHAT);
 // A text holding Hermes' own default values gets Godspeed's.
 assert.deepEqual(chatSettings(HERMES_DEFAULTS),FAST_CHAT);
 const fresh=godspeedHermesSettings(HERMES_DEFAULTS);
 for(const line of ['compression:','  threshold: 0.5','  target_ratio: 0.2','display:','  compact: false','  tool_progress: all','  tool_progress_overrides: {}','  transport: auto','_config_version: 44'])assert.ok(fresh.includes(line+'\n'),line);
 assert.equal(readConfigValue(fresh,['display','streaming']),'false','the setting for Hermes own terminal is left as it was');
 // A second run of the function over its own output changes nothing.
 for(const text of ['',LIVE,HERMES_DEFAULTS]){const out=godspeedHermesSettings(text);assert.equal(godspeedHermesSettings(out),out);}
});

test('a value the owner set themselves stays',()=>{
 const owner=godspeedHermesSettings('compression:\n  threshold_tokens: 150000\n');
 assert.equal(readConfigValue(owner,['compression','threshold_tokens']),'150000');
 assert.equal(godspeedHermesSettings(owner),owner);
 // Hermes' third word for the heartbeat is "generic" (one line, no tool names): not its default,
 // so it is the owner's.
 const generic=godspeedHermesSettings('display:\n  platforms:\n    telegram:\n      long_running_notifications: generic\n');
 assert.equal(readConfigValue(generic,['display','platforms','telegram','long_running_notifications']),'generic');
 assert.equal(readConfigValue(generic,['display','platforms','telegram','interim_assistant_messages']),'false','the rest still goes in');
 assert.equal(godspeedHermesSettings(generic),generic);
});

const wireScript=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
const wire=(root,home)=>execFileSync(process.execPath,[wireScript,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41991',GODSPEED_DEVICE:'local',GODSPEED_ORIGINAL_RUNTIME:'on'},windowsHide:true});

test('every wiring of a mission control made from the starter gives its Hermes those settings and the scheduler plugin',t=>{
 const base=temporary(t,'wire-hermes'),root=path.join(base,'workspace'),home=path.join(base,'assistant');installStarter(root);
 fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'\uFEFF'+LIVE.replace(':47951/',':41991/'));
 wire(root,home);
 const text=fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 assert.equal(readConfigValue(text,['memory','user_profile_enabled']),'false');
 assert.deepEqual(configList(readConfigValue(text,['agent','disabled_toolsets'])),['clarify','memory']);
 assert.equal(readConfigValue(text,['tools','tool_search','enabled']),'"off"');
 assert.equal(readConfigValue(text,['cron','provider']),'godspeed_notebook');
 // The provider Hermes loads from its plugins folder: its own built-in ticker under another name.
 const plugin=fs.readFileSync(path.join(home,'plugins','godspeed_notebook','__init__.py'),'utf8');
 assert.match(plugin,/from cron\.scheduler_provider import InProcessCronScheduler/);
 assert.match(plugin,/return "godspeed_notebook"/);
 assert.match(JSON.parse(fs.readFileSync(path.join(home,'plugins','godspeed_notebook','report.json'),'utf8')).script,/background-report\.mjs$/);assert.match(plugin,/def register\(ctx\):\n    ctx\.register_cron_scheduler\(/);
 assert.ok(!fs.existsSync(path.join(home,'plugins','godspeed_notebook','plugin.yaml')),'not a general plugin: Hermes would list it among them');
 // mc-watch and mc-subs, which the watch and subscription recipes name, exist with the original assistant too.
 for(const name of ['mc-watch','mc-subs'])assert.match(fs.readFileSync(path.join(home,'bin',name),'utf8'),new RegExp('personal-command\\.mjs\' \''+name.slice(3)+'\' "\\$@"'));
 // The add-ons' context plugins are enabled, the Charm Challenge's too (spec 2026-10-21), each with
 // its mission control, its recipe and its command.
 assert.deepEqual(configList(readConfigValue(text,['plugins','enabled'])),['godspeed-coach','godspeed-journal','godspeed-headache','godspeed-charm','godspeed-context','godspeed-reply','godspeed-chat-tidy']);
 // The night chat tidy-up's command is copied into the home, not only named as enabled.
 assert.match(fs.readFileSync(path.join(home,'plugins','godspeed-chat-tidy','plugin.yaml'),'utf8'),/^name: godspeed-chat-tidy$/m);
 assert.match(fs.readFileSync(path.join(home,'plugins','godspeed-chat-tidy','__init__.py'),'utf8'),/COMMAND = "godspeed-chat-tidy"[\s\S]*def register\(ctx\):\n[\s\S]*ctx\.register_command\(COMMAND, tidy/);
 assert.equal(fs.readFileSync(path.join(home,'plugins','godspeed-charm','mission-control.txt'),'utf8'),root+'\n');
 assert.match(fs.readFileSync(path.join(home,'plugins','godspeed-charm','__init__.py'),'utf8'),/GODSPEED_CHARM_SCRIPT/);
 assert.match(fs.readFileSync(path.join(home,'skills','charm-challenge','SKILL.md'),'utf8'),/^---\nname: charm-challenge\n/);
 assert.match(fs.readFileSync(path.join(home,'bin','godspeed-charm'),'utf8'),/godspeed-charm\.mjs/);
 // Wiring again changes nothing.
 wire(root,home);assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),text);
});

test('an adopted mission control keeps its assistant as it was, apart from the delivery wrapper',t=>{
 const base=temporary(t,'wire-adopted-hermes'),root=path.join(base,'workspace'),home=path.join(base,'assistant');
 fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# Mine\n');fs.writeFileSync(path.join(root,'rules','mine.md'),'Mine.\n');installStarter(root);
 wire(root,home);const text=fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 for(const keys of [['memory','user_profile_enabled'],['agent','disabled_toolsets'],['tools','tool_search','enabled']])assert.equal(readConfigValue(text,keys),null,keys.join('.'));
 assert.equal(readConfigValue(text,['cron','provider']),'godspeed_notebook');
 assert.ok(fs.existsSync(path.join(home,'plugins','godspeed_notebook','__init__.py')));assert.ok(fs.existsSync(path.join(home,'plugins','godspeed_notebook','report.json')));
 wire(root,home);assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),text,'wiring again changes nothing');
 // A scheduler the owner chose stays.
 const other=path.join(base,'other');fs.mkdirSync(other);fs.writeFileSync(path.join(other,'config.yaml'),'cron:\n  provider: owners_own\n');
 const said=spawnSync(process.execPath,[wireScript,other],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41991',GODSPEED_DEVICE:'local',GODSPEED_ORIGINAL_RUNTIME:'on'},encoding:'utf8',windowsHide:true});
 assert.equal(said.status,0);assert.match(said.stderr,/delivery wrapper is not active.*"owners_own".*plain yes cannot reach it/);
 assert.equal(readConfigValue(fs.readFileSync(path.join(other,'config.yaml'),'utf8'),['cron','provider']),'owners_own');
 assert.ok(fs.existsSync(path.join(other,'plugins','godspeed_notebook','__init__.py')));assert.ok(fs.existsSync(path.join(other,'plugins','godspeed_notebook','report.json')),'the wrapper is installed beside a provider the owner chose');
});

// "Run now" waited for the whole run (a live run's fetch gave up after 300 seconds).
test('Run now answers at once and the routine runs on in the background',async t=>{
 const root=temporary(t,'run-now'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'});
 store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'brief',name:'Morning brief'}]}));
 let finish;const calls=[];
 const scheduler=new NativeScheduler(store,{executable:'hermes',home,device:'pc',run:async(exe,args)=>{calls.push(args.join(' '));await new Promise(r=>{finish=r;});return {stdout:'done'};}});
 assert.deepEqual(scheduler.startRun('brief'),{started:true,id:'brief'});
 await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls,['cron run brief'],'the run started');assert.ok(scheduler.running,'and is still going');
 finish();await scheduler.running?.catch(()=>{});
 assert.throws(()=>scheduler.startRun('nope'),/Choose an existing Hermes task/,'a wrong id is said at once');
 store.save('settings',{id:'installation',owner:'vps'});
 assert.throws(()=>scheduler.startRun('brief'),/machine named vps/);
});

test('Run now keeps the admitted Hermes child, and a refusal keeps its real lifecycle owner',async t=>{
 const root=temporary(t,'run-diagnostics'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'});
 store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'brief',name:'Morning brief'}]}));
 let finish,calls=0;const scheduler=new NativeScheduler(store,{executable:'hermes',home,device:'pc',run:async(executable,args,{onStart}={})=>{calls++;onStart?.({pid:4321,tree:[{pid:4321,parent:process.pid},{pid:4322,parent:4321}]});await new Promise(resolve=>{finish=resolve;});return {code:0,signal:null,stdout:'the Hermes run log',stderr:'the Hermes warning'};}});
 assert.deepEqual(scheduler.startRun('brief'),{started:true,id:'brief'});
 await new Promise(resolve=>setImmediate(resolve));
 assert.throws(()=>scheduler.startRun('brief'),/updating or another routine is already running/);assert.equal(calls,1,'the refusal did not start a concurrent Hermes command');
 let diagnostics=JSON.parse(fs.readFileSync(path.join(store.state,'routine-run-diagnostics.json'),'utf8')).runs;
 assert.deepEqual(diagnostics.map(run=>({admitted:run.admitted,lifecycle_owner:run.lifecycle_owner})),[{admitted:true,lifecycle_owner:'routine run'},{admitted:false,lifecycle_owner:'routine run'}]);
 assert.deepEqual(diagnostics[0].command,['hermes','cron','run','brief']);assert.deepEqual(diagnostics[0].child,{pid:4321,tree:[{pid:4321,parent:process.pid},{pid:4322,parent:4321}]});
 finish();await scheduler.running;
 diagnostics=JSON.parse(fs.readFileSync(path.join(store.state,'routine-run-diagnostics.json'),'utf8')).runs;
 assert.equal(diagnostics[0].exit_status,0);assert.equal(diagnostics[0].stderr,'the Hermes warning');assert.equal(diagnostics[0].run_log.command_output,'the Hermes run log');assert.equal(diagnostics[0].run_log.path,path.join(home,'cron','output'));
});

test('a failed admitted Hermes child retains its exit status and stderr',async t=>{
 const root=temporary(t,'run-diagnostic-failure'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'});
 store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.writeFileSync(path.join(home,'cron','jobs.json'),JSON.stringify({jobs:[{id:'brief',name:'Morning brief'}]}));
 const scheduler=new NativeScheduler(store,{executable:'hermes',home,device:'pc',run:async(executable,args,{onStart}={})=>{onStart?.({pid:4321,tree:[{pid:4321,parent:process.pid}]});throw Object.assign(Error('Command failed with exit code 12'),{code:12,stderr:'Hermes routine failure'});}});
 scheduler.startRun('brief');await scheduler.running.catch(()=>{});
 const run=JSON.parse(fs.readFileSync(path.join(store.state,'routine-run-diagnostics.json'),'utf8')).runs[0];
 assert.equal(run.exit_status,12);assert.equal(run.stderr,'Hermes routine failure');assert.deepEqual(run.child,{pid:4321,tree:[{pid:4321,parent:process.pid}]});
});

test('interrupted Hermes children retain their buffered output in routine diagnostics',async t=>{
 const root=temporary(t,'interrupted-run-diagnostics'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'}),jobs=path.join(home,'cron','jobs.json');
 store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});fs.mkdirSync(path.dirname(jobs),{recursive:true});fs.writeFileSync(jobs,JSON.stringify({jobs:[{id:'brief',name:'Morning brief'}]}));
 for(const code of ['TIMEOUT','OUTPUT_LIMIT','ABORTED']){
  const scheduler=new NativeScheduler(store,{executable:'hermes',home,device:'pc',run:async()=>{throw Object.assign(Error('Hermes stopped'),{code,stdout:'before stdout '+code,stderr:'before stderr '+code});}});
  scheduler.startRun('brief');await scheduler.running.catch(()=>{});
  const run=JSON.parse(fs.readFileSync(path.join(store.state,'routine-run-diagnostics.json'),'utf8')).runs.at(-1);
  assert.equal(run.exit_status,code);assert.match(run.stderr,new RegExp('before stderr '+code));assert.match(run.run_log.command_output,new RegExp('before stdout '+code));
 }
});

test('run diagnostics use durable ids, one command specification, and scrubbed output',async t=>{
 const root=temporary(t,'durable-run-diagnostics'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'}),jobs=path.join(home,'cron','jobs.json');
 store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});fs.mkdirSync(path.dirname(jobs),{recursive:true});fs.writeFileSync(jobs,JSON.stringify({jobs:[{id:'brief',name:'Morning brief'}]}));
 const failure=Object.assign(Error('Command failed with exit code 12'),{code:12,stderr:'\u001b[31mapi_key=sk-secret-token-12345678\u001b[0m\nkept stderr',stdout:'\u001b[32mBearer secret-token-123456789\u001b[0m\nkept stdout'}),calls=[],run=async(executable,args)=>{calls.push([executable,...args]);throw failure;};
 const first=new NativeScheduler(store,{executable:'hermes',home,device:'pc',run});first.startRun('brief');await first.running.catch(()=>{});
 const second=new NativeScheduler(store,{executable:'hermes-renamed',home,device:'pc',run});second.startRun('brief');await second.running.catch(()=>{});
 const diagnostics=JSON.parse(fs.readFileSync(path.join(store.state,'routine-run-diagnostics.json'),'utf8')).runs.filter(entry=>entry.admitted);
 assert.equal(new Set(diagnostics.map(entry=>entry.id)).size,2);assert.deepEqual(diagnostics.map(entry=>entry.command),[['hermes','cron','run','brief'],['hermes-renamed','cron','run','brief']]);assert.deepEqual(calls,diagnostics.map(entry=>entry.command));
 for(const entry of diagnostics){assert.doesNotMatch(entry.stderr,/sk-secret-token|\x1b\[/);assert.doesNotMatch(entry.run_log.command_output,/secret-token|\x1b\[/);assert.match(entry.stderr,/kept stderr/);assert.match(entry.run_log.command_output,/kept stdout/);}
});

test('a procfs snapshot failure leaves the admitted routine protected by its lease',async t=>{
 const root=temporary(t,'procfs-routine-lease'),home=path.join(root,'.hermes'),store=new Store(root,{device:'pc'}),jobs=path.join(home,'cron','jobs.json'),readdir=fs.readdirSync;
 store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});fs.mkdirSync(path.dirname(jobs),{recursive:true});fs.writeFileSync(jobs,JSON.stringify({jobs:[{id:'brief',name:'Morning brief'}]}));
 fs.readdirSync=(file,...args)=>{if(file==='/proc')throw Object.assign(Error('proc unavailable'),{code:'EACCES'});return readdir(file,...args);};t.after(()=>{fs.readdirSync=readdir;});
 let calls=0;const scheduler=new NativeScheduler(store,{executable:'hermes',home,device:'pc',tickLimit:500,run:(executable,args,options)=>{calls++;return runChild(process.execPath,['-e','setTimeout(()=>process.exit(0),200)'],{timeoutMs:options.timeout,maxBytes:options.maxBuffer,onStart:options.onStart});}});
 scheduler.startRun('brief');await new Promise(resolve=>setTimeout(resolve,30));
 assert.throws(()=>scheduler.startRun('brief'),/updating or another routine is already running/);assert.equal(calls,1);await scheduler.running;
});

// Hermes stops a cron script at cron.script_timeout_seconds (3600 unless set), one setting for all
// jobs. The nightly goal research may run 120 minutes plus a fix round, so the order below must hold:
// the routine's own limit, then Hermes' script limit, then the notebook's limit for a whole tick.
test("the research night fits inside Hermes' script limit, which fits inside the tick limit",async()=>{
 assert.equal(readConfigValue(godspeedHermesSettings(''),['cron','script_timeout_seconds']),String(SCRIPT_TIMEOUT_SECONDS));
 assert.equal(readConfigValue(godspeedHermesSettings('cron:\n  script_timeout_seconds: 3600\n'),['cron','script_timeout_seconds']),String(SCRIPT_TIMEOUT_SECONDS),'an existing install gets it too');
 assert.equal(readConfigValue(godspeedHermesSettings('cron:\n  script_timeout_seconds: 20000\n'),['cron','script_timeout_seconds']),'20000','a larger value the owner chose stays');
 const {TICK_LIMIT}=await import('../core/native-scheduler.mjs');
 const python=fs.readFileSync(new URL('../core/routine-scripts/godspeed_routines.py',import.meta.url),'utf8');
 const minutes=Number(/^RESEARCH_MINUTES = (\d+)/m.exec(python)[1]),own=minutes*60+900;
 assert.equal(minutes,120);assert.equal(own,8100);
 assert.ok(own<SCRIPT_TIMEOUT_SECONDS,'the routine stops itself before Hermes does');
 assert.ok(SCRIPT_TIMEOUT_SECONDS*1000<TICK_LIMIT,'and Hermes stops it before the tick is killed');
 // The coaching talk preparation (18 October 2026) has the same two hours and the same order, and
 // its 03:00 start with its own limit ends before the daily round chooses at 05:30.
 const prep=Number(/^PREP_MINUTES = (\d+)/m.exec(python)[1]),prepOwn=prep*60+900;
 assert.equal(prep,120);assert.ok(prepOwn<SCRIPT_TIMEOUT_SECONDS,'the preparation stops itself before Hermes does');
 const {STARTING_ROUTINES}=await import('../core/starting-routines.mjs'),at=key=>{const [m,h]=STARTING_ROUTINES.find(r=>r.key===key).schedule.split(' ').map(Number);return h*3600+m*60;};
 assert.ok(at('research')+own<=at('coach-prep'),'it starts after the research night can have ended');
 assert.ok(at('coach-prep')+prepOwn<at('decide'),'and ends before the daily round chooses');
});

// Issue #127: the failure sentence says what the provider answered, without any key.
import {hermesFailureMessage as failureMessage,providerReason} from '../core/runtime.mjs';
import assertStrict from 'node:assert/strict';
import {test as nodeTest} from 'node:test';
nodeTest('a failed AI request says the provider status and hides keys',()=>{
  const said=failureMessage('x\nError code: 400 - {"error":{"message":"messages: text content blocks must be non-empty"}} Bearer sk-or-v1-abcdef1234567890abcdef\n');
  assertStrict.match(said,/^The AI request failed \(.*400.*non-empty.*\)\. Check the AI connection in Settings, then try again\.$/);
  assertStrict.doesNotMatch(said,/sk-or-v1|abcdef1234567890/);
  assertStrict.equal(providerReason('nothing useful here'),'');
  assertStrict.equal(failureMessage('boom'),'The AI request failed. Check the AI connection in Settings, then try again.');
});
nodeTest('credential-shaped parts of a provider line never reach the sentence',()=>{
  for(const line of ['HTTP 401 Authorization: Basic dXNlcjpwYXNzd29yZA==','HTTP 400 api_key=abc123 failed','Error code: 401 {"api_key":"zzz999","message":"bad"}','HTTP 403 x-api-key: secretvalue1','HTTP 401: access_token=abc.def.ghi']){
    const said=failureMessage(line);
    assertStrict.doesNotMatch(said,/dXNlcjpwYXNzd29yZA|abc123|zzz999|secretvalue1|abc.def.ghi/);
    assertStrict.match(said,/^The AI request failed \(/);
  }
});
