import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {NativeScheduler} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {runCommand} from '../core/child-process.mjs';import {CHAT_TIDY_JOB,CHAT_TIDY_SCRIPT,readNotebookRoutines} from '../core/notebook-routines.mjs';
import {nightTidyGates} from '../../scenarios/night-tidy-gates.mjs';

// THE NIGHT CHAT TIDY-UP ACROSS AN UPDATE (#721). On 18 November 2026 update-keeps-everything found
// no tidy-up after an update for a person whose chat is on Telegram, and every gate on the way to
// making it returns without a word. An update leaves the mission control's folder and the
// assistant's home as they were and starts a new notebook, so here an update is a new store and a
// new scheduler on the same folders, as the scenario's order has it: the first goal, then a Telegram
// chat the gateway routes, then the update, then two ticks. Each tick prints what every gate said
// (scenarios/night-tidy-gates.mjs, which the scenario prints on a real machine), so a red run says
// which gate it was.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-night-tidy-update-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
function fakeHermes(home,{refuse=()=>false}={}){
 let serial=0;const file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).jobs:[],write=jobs=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs}));};
 const created=[];
 const run=async(exe,args,options={})=>{
  if(exe!=='hermes')return runCommand(exe,args,options);
  const [,verb,...rest]=args,flag=name=>{const i=rest.indexOf(name);return i===-1?null:rest[i+1];},jobs=read();
  if(verb==='create'){
   if(refuse(flag('--name')))throw Object.assign(Error('Hermes could not create it'),{code:1,stderr:'cron create: refused'});
   const job={id:'job'+(++serial),name:flag('--name'),schedule:{kind:'cron',expr:rest[0]},schedule_display:rest[0],script:flag('--script'),skill:flag('--skill'),deliver:flag('--deliver'),workdir:flag('--workdir'),enabled:true,state:'scheduled',created_at:new Date().toISOString()};
   jobs.push(job);write(jobs);created.push(job.name);
  }
  if(verb==='remove')write(jobs.filter(j=>j.id!==rest[0]));
  return {stdout:''};
 };
 return {run,jobs:read,write,created};
}
// The person's Telegram chat, routed the way the gateway keys it and the scenario seeds it
// (scenarios/night-tidy-chat.mjs): no bot token in .env, only the routing table says there is a chat app.
function routeTelegramChat(home){
 const db=new DatabaseSync(path.join(home,'state.db'));
 db.exec('create table if not exists gateway_routing(scope text, session_key text, entry_json text)');
 db.prepare('insert into gateway_routing values (?,?,?)').run(home.replace(/[\\/]+$/,'')+path.sep+'sessions','agent:main:telegram:dm:4242',JSON.stringify({session_id:'scenario-chat-1'}));
 db.close();
}
async function installed(t,hermesOptions){
 const root=temporary(t),home=path.join(root,'.hermes-home');installStarter(root);fs.mkdirSync(home,{recursive:true});
 // The machine's own name, the way the notebook server writes it on first start (device-id.mjs):
 // the gates read it to say the owns gate, the tick's first one.
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});
 fs.writeFileSync(path.join(root,'.godspeed','device.json'),JSON.stringify({id:'pc',created_at:new Date().toISOString()})+'\n');
 fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: x\n');
 const hermes=fakeHermes(home,hermesOptions);
 const notebook=()=>{const failures=[],scheduler=new NativeScheduler(new Store(root,{device:'pc'}),{home,executable:'hermes',device:'pc',run:hermes.run});scheduler.onFailure=error=>failures.push(error.message);return {scheduler,failures};};
 const before=notebook();
 await before.scheduler.configure({goal:'Keep the scenario ready',timezone:'Etc/UTC'});
 return {root,home,hermes,notebook,before};
}
const tidies=hermes=>hermes.jobs().filter(j=>j.name===CHAT_TIDY_JOB);
async function twoTicks(label,{root,home,hermes},{scheduler,failures}){
 const seen=[];
 for(const tick of [1,2]){
  scheduler.lastTick=0;await scheduler.tick();
  const gates=nightTidyGates({root,home});seen.push(gates);
  console.log(`${label}, tick ${tick}: ${JSON.stringify(gates)}`);
  if(failures.length)console.log(`${label}, tick ${tick}, what the scheduler reported: ${failures.join(' | ')}`);
 }
 assert.equal(seen.at(-1).tidy_jobs.length,tidies(hermes).length,'the gates read the same jobs file the scheduler wrote');
 return seen;
}

test('after an update, a person whose chat is on Telegram has the night chat tidy-up within two ticks, once',async t=>{
 const machine=await installed(t);
 routeTelegramChat(machine.home);
 const before=nightTidyGates(machine);
 console.log('before the update: '+JSON.stringify(before));
 assert.equal(before.routed_owner_chats,1,'the routing table names the owner chat under the scheduler\'s own scope');
 const seen=await twoTicks('after the update',machine,machine.notebook());
 assert.deepEqual(seen.map(g=>g.outcome),['job-present','job-present']);
 assert.equal(tidies(machine.hermes).length,1);
 assert.equal(tidies(machine.hermes)[0].script,CHAT_TIDY_SCRIPT);
 assert.equal(readNotebookRoutines(new Store(machine.root,{device:'pc'})).jobs.filter(j=>j.key==='chat-tidy').length,1);
});

test('a tidy-up the notebook made before the update is the one there after it, not a second',async t=>{
 const machine=await installed(t);
 routeTelegramChat(machine.home);
 machine.before.scheduler.lastTick=0;await machine.before.scheduler.tick();
 const made=tidies(machine.hermes).map(j=>j.id);
 assert.equal(made.length,1,'made before the update');
 await twoTicks('after the update',machine,machine.notebook());
 assert.deepEqual(tidies(machine.hermes).map(j=>j.id),made);
});

test("a person's earlier removal of the tidy-up survives an update",async t=>{
 const machine=await installed(t);
 routeTelegramChat(machine.home);
 machine.before.scheduler.lastTick=0;await machine.before.scheduler.tick();
 const [job]=tidies(machine.hermes);assert.ok(job,'made before the update');
 // The person removes it, the way Settings and the chat remove a routine: Hermes no longer has it.
 machine.hermes.write(machine.hermes.jobs().filter(j=>j.id!==job.id));
 const seen=await twoTicks('removed by the person, after the update',machine,machine.notebook());
 assert.deepEqual(seen.map(g=>g.outcome),['kept-removed','kept-removed']);
 assert.equal(seen.at(-1).remembered.id,job.id);
 assert.equal(tidies(machine.hermes).length,0,'not made again');
 assert.equal(machine.hermes.created.filter(name=>name===CHAT_TIDY_JOB).length,1,'Hermes was never asked to make it again');
});

test('a create the chat app refuses after an update is reported, and the next tick makes it',async t=>{
 let refusing=true;
 const machine=await installed(t,{refuse:name=>refusing&&name===CHAT_TIDY_JOB});
 routeTelegramChat(machine.home);
 const after=machine.notebook();
 after.scheduler.lastTick=0;await after.scheduler.tick();
 const refused=nightTidyGates(machine);
 console.log('after the update, the create refused: '+JSON.stringify(refused)+'; the scheduler reported: '+after.failures.join(' | '));
 assert.equal(refused.outcome,'would-create','nothing is remembered for a create that failed');
 assert.ok(after.failures.some(message=>/Hermes could not create it/.test(message)),'the failed create reaches onFailure, which the service logs');
 refusing=false;
 after.scheduler.lastTick=0;await after.scheduler.tick();
 assert.equal(nightTidyGates(machine).outcome,'job-present');
 assert.equal(tidies(machine.hermes).length,1);
});

test('a machine that does not run the routines is said by the gates, and the tick makes nothing',async t=>{
 const machine=await installed(t);
 routeTelegramChat(machine.home);
 await machine.before.scheduler.transfer('other-pc');
 const seen=await twoTicks('not this machine',machine,machine.notebook());
 assert.deepEqual(seen.map(g=>g.outcome),['not-owner','not-owner']);
 assert.equal(seen.at(-1).installation_owner,'other-pc');
 assert.equal(seen.at(-1).device,'pc');
 assert.equal(seen.at(-1).owns,false);
 assert.equal(tidies(machine.hermes).length,0,'the tick on this machine makes nothing');
 assert.equal(machine.hermes.created.filter(name=>name===CHAT_TIDY_JOB).length,0,'Hermes was never asked to make it here');
});

test('with no chat app, or a chat routed under another spelling of the home, the gates say no chat app',async t=>{
 const machine=await installed(t);
 await twoTicks('no chat app yet',machine,machine.notebook());
 assert.equal(nightTidyGates(machine).outcome,'no-chat-app');
 assert.equal(tidies(machine.hermes).length,0);
 // A chat routed under another spelling of the home is one the scheduler does not see.
 const elsewhere=path.join(machine.root,'elsewhere'),db=new DatabaseSync(path.join(machine.home,'state.db'));
 db.exec('create table gateway_routing(scope text, session_key text, entry_json text)');
 db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(elsewhere,'sessions'),'agent:main:telegram:dm:4242','{}');db.close();
 const gates=nightTidyGates(machine);
 assert.equal(gates.outcome,'no-chat-app');
 assert.deepEqual(gates.owner_chat_scopes,[path.join(elsewhere,'sessions')]);
});
