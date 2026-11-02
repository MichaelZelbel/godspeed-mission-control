import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
import {installStarter} from '../core/starter-workspace.mjs';
import {readConfigValue,configList} from '../core/hermes-config.mjs';

// Issue #140: Godspeed's one outgoing step (the godspeed-reply plugin) is installed and enabled by the
// assistant wiring, and a second plugin that registers its own transform_llm_output is named in one line.
const wireScript=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
const temporary=(t,name)=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-'+name+'-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
const wire=(root,home)=>spawnSync(process.execPath,[wireScript,home],{encoding:'utf8',env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41991',GODSPEED_DEVICE:'local',GODSPEED_ORIGINAL_RUNTIME:'on'},windowsHide:true});
const lines=result=>result.stderr.split('\n').filter(l=>/transform_llm_output/.test(l));
const setup=t=>{const base=temporary(t,'wire-reply'),root=path.join(base,'workspace'),home=path.join(base,'assistant');installStarter(root);fs.mkdirSync(home,{recursive:true});return {root,home};};

test('the reply plugin is installed beside the context plugin, enabled, and knows its mission control and the model command',t=>{
 const {root,home}=setup(t);
 const first=wire(root,home);assert.equal(first.status,0,first.stderr);
 const plugin=path.join(home,'plugins','godspeed-reply');
 assert.match(fs.readFileSync(path.join(plugin,'__init__.py'),'utf8'),/transform_llm_output/);
 assert.match(fs.readFileSync(path.join(plugin,'plugin.yaml'),'utf8'),/^name: godspeed-reply/m);
 assert.equal(fs.readFileSync(path.join(plugin,'mission-control.txt'),'utf8'),root+'\n');
 const command=fs.readFileSync(path.join(plugin,'model-command.txt'),'utf8').trim();
 assert.equal(command,path.join(home,'bin','godspeed-model'));assert.ok(fs.existsSync(command));
 const text=fs.readFileSync(path.join(home,'config.yaml'),'utf8');
 assert.ok(configList(readConfigValue(text,['plugins','enabled'])).includes('godspeed-reply'));
 assert.deepEqual(lines(first),[],'the add-ons that hand their reply to the steps are not named');
 const again=wire(root,home);assert.equal(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),text);assert.deepEqual(lines(again),[]);
});

test('an already enabled list gains the reply plugin,',t=>{
 const {root,home}=setup(t);
 fs.writeFileSync(path.join(home,'config.yaml'),'plugins:\n  enabled: ["godspeed-coach", "my-own"]\n');
 assert.equal(wire(root,home).status,0);
 assert.ok(configList(readConfigValue(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),['plugins','enabled'])).includes('godspeed-reply'));
});

test('one line names a second enabled plugin that registers transform_llm_output, and only that one',t=>{
 const {root,home}=setup(t);
 const own=(name,body)=>{const dir=path.join(home,'plugins',name);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'__init__.py'),body);};
 own('my-voice','def register(ctx):\n    ctx.register_hook("transform_llm_output", lambda **k: None)\n');
 own('quiet-one','def register(ctx):\n    ctx.register_hook("pre_llm_call", lambda **k: None)\n');
 own('not-enabled','def register(ctx):\n    ctx.register_hook("transform_llm_output", lambda **k: None)\n');
 fs.writeFileSync(path.join(home,'config.yaml'),'plugins:\n  enabled: ["my-voice", "quiet-one"]\n');
 const result=wire(root,home);assert.equal(result.status,0,result.stderr);
 const found=lines(result);assert.equal(found.length,1,result.stderr);
 assert.match(found[0],/my-voice/);assert.doesNotMatch(found[0],/quiet-one|not-enabled|godspeed-charm|godspeed-coach/);
});
