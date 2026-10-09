import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {NativeScheduler} from '../core/native-scheduler.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {godspeedHermesSettings,setConfigValue,readConfigValue,configList,CRON_PROVIDER} from '../core/hermes-config.mjs';

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
 assert.match(plugin,/return "godspeed_notebook"/);assert.match(plugin,/def register\(ctx\):\n    ctx\.register_cron_scheduler\(/);
 assert.ok(!fs.existsSync(path.join(home,'plugins','godspeed_notebook','plugin.yaml')),'not a general plugin: Hermes would list it among them');
 // mc-watch and mc-subs, which the watch and subscription recipes name, exist with the original assistant too.
 for(const name of ['mc-watch','mc-subs'])assert.match(fs.readFileSync(path.join(home,'bin',name),'utf8'),new RegExp('personal-command\\.mjs\' \''+name.slice(3)+'\' "\\$@"'));
 // Wiring again changes nothing.
 wire(root,home);assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),text);
});

test('an adopted mission control keeps its assistant as it was',t=>{
 const base=temporary(t,'wire-adopted-hermes'),root=path.join(base,'workspace'),home=path.join(base,'assistant');
 fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# Mine\n');fs.writeFileSync(path.join(root,'rules','mine.md'),'Mine.\n');installStarter(root);
 wire(root,home);const text=fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 for(const keys of [['memory','user_profile_enabled'],['agent','disabled_toolsets'],['tools','tool_search','enabled'],['cron','provider']])assert.equal(readConfigValue(text,keys),null,keys.join('.'));
 assert.ok(!fs.existsSync(path.join(home,'plugins','godspeed_notebook')));
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
