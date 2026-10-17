import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {nativeAgent} from '../core/native-agent.mjs';import {NativeScheduler,nativeJobs} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {Domains} from '../core/domains.mjs';import {QueryService} from '../core/query.mjs';
import {execFileSync} from 'node:child_process';import {installStarter,adoptedMissionControl} from '../core/starter-workspace.mjs';import {FLAG,readMachineRecord,writeMachineRecord} from '../core/starting-routines.mjs';import {runCommand} from '../core/child-process.mjs';
import {beginContext,scheduleInvite,setTimezone,writeContext,INVITE_JOB} from '../core/context-setup.mjs';
const goalsTool=fileURLToPath(new URL('../../tools/goals.js',import.meta.url));
// The chat files a goal with the original tool. It finds its mission control from GODSPEED_ROOT or the
// folder it runs in, never from a flag, so both are this fixture's.
const fileGoal=(root,...args)=>execFileSync(process.execPath,[goalsTool,'file','--kind','outcome','--source','chat, 2026-10-08',...args],{cwd:root,env:{...process.env,GODSPEED_ROOT:root,GODSPEED_DIR:root},windowsHide:true});
function fixture(t){const base=fileURLToPath(new URL('../../.test-tmp/',import.meta.url));fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'native-godspeed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('notebook transport preserves the real Hermes agent loop, tools and named conversation',async()=>{
 let captured;const agent=nativeAgent({executable:'hermes',home:'fixture-home',cwd:'fixture-workspace',spawnProcess:(exe,args,options)=>{captured={exe,args,options};const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',data=>{assert.equal(String(data),'Fictional question');queueMicrotask(()=>{child.stdout.write('Fictional reply');child.emit('close',0);});});return child;}});
 assert.equal((await agent({message:'Fictional question',conversation_id:'fictional-thread'})).reply,'Fictional reply');
 assert.equal(captured.exe,'hermes');assert.ok(captured.args.includes('--continue'));assert.ok(captured.args.includes('--create-if-missing'));assert.equal(captured.args.includes('--max-turns'),false);assert.equal(captured.args.includes('--toolsets'),false);
 assert.equal(captured.options.env.GODSPEED_FILE_HERMES,'0');
});
test('a message from the page that shows who the assistant is reaches Hermes with that page\'s numbered parts',async()=>{
 let sent='';const agent=nativeAgent({executable:'hermes',home:'fixture-home',cwd:'fixture-workspace',spawnProcess:()=>{const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin.on('data',data=>{sent+=String(data);queueMicrotask(()=>{child.stdout.write('Fictional reply');child.emit('close',0);});});return child;}});
 await agent({message:'Change rule 3 so that it says hello.',conversation_id:'notebook:page:identity',page_context:'The owner has the notebook page open.\n3. Never spend my money (rule:never-spend-my-money)'});
 assert.equal(sent,'Change rule 3 so that it says hello.\n\nThe owner has the notebook page open.\n3. Never spend my money (rule:never-spend-my-money)');
});
test('Godspeed chat uses native Hermes rather than the notebook action planner while memory stays connected',async t=>{
 const store=new Store(fixture(t)),domains=new Domains(new QueryService(store),{provider:()=>assert.fail('Replacement planner ran')});domains.nativeAgent=async input=>({reply:'Original agent '+input.message});
 assert.equal((await domains.invoke('conversation-chat',{message:'Fictional question',conversation_id:'fixture'})).reply,'Original agent Fictional question');
 assert.equal(store.list('conversation_messages').at(-1).source_app,'hermes');
 const note=await store.saveAsync('notes',{title:'Fictional memory',content:'Menerio remains connected'});assert.equal(store.get('notes',note.id).content,'Menerio remains connected');
});
test('native setup files the goal using the original main tool and creates no replacement routines',async t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'rules'));const store=new Store(root),home=path.join(root,'.hermes'),scheduler=new NativeScheduler(store,{home,executable:'hermes'});
 await scheduler.configure({goal:'Fictional original goal',timezone:'Europe/Berlin'});
 assert.ok(fs.existsSync(path.join(root,'goals/fictional-original-goal.md')));assert.match(fs.readFileSync(path.join(root,'goals/fictional-original-goal.md'),'utf8'),/STATUS: adopted/);
 // A folder not made from the starter gets no routines at all (starting-routines tests below).
 assert.equal(store.list('jobs').length,0);assert.equal(nativeJobs(home).length,0);
});

// The routines the book's first goal starts (Teach It Once, Chapters 3, 5, 8, 24 and 30): until
// 8 October 2026 a reader's first goal started nothing with the original assistant.
// A Hermes stand-in that keeps its jobs the way Hermes does (cron/jobs.json); every other command
// runs for real (tools/goals.js files the goal).
function fakeHermes(home,{fail}={}){
 let serial=0;const calls=[],file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).jobs:[],write=jobs=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs}));};
 const run=async(exe,args,options={})=>{
  if(exe!=='hermes')return runCommand(exe,args,options);
  calls.push({args,timezone:options.env?.HERMES_TIMEZONE,home:options.env?.HERMES_HOME});
  const [,verb,...rest]=args;
  if(verb==='create'){
   if(fail&&rest.includes(fail))throw Object.assign(Error('Command failed with exit code 1'),{stderr:'fictional refusal'});
   const flag=name=>{const i=rest.indexOf(name);return i===-1?null:rest[i+1];},noAgent=rest.includes('--no-agent'),prompt=noAgent?null:rest[1];
   // As Hermes keeps it (cron/jobs.py, create_job): an ISO moment is a one-time job, run once.
   const once=/^\d{4}-\d\d-\d\dT/.test(rest[0]),schedule=once?{kind:'once',run_at:rest[0]}:{kind:'cron',expr:rest[0]};
   const jobs=read();jobs.push({id:'job'+(++serial),name:flag('--name'),schedule,schedule_display:rest[0],repeat:{times:once?1:null,completed:0},prompt,script:flag('--script'),skill:flag('--skill'),no_agent:noAgent,deliver:flag('--deliver'),failure_deliver:flag('--failure-deliver'),workdir:flag('--workdir'),enabled:true,state:'scheduled',created_at:new Date().toISOString(),next_run_at:null,last_run_at:null,last_status:null});write(jobs);
  }
  if(verb==='remove')write(read().filter(j=>j.id!==rest[0]));
  return {stdout:''};
 };
 return {run,calls,jobs:read,write};
}
function starterFixture(t,{config=true}={}){
 const root=fixture(t),home=path.join(root,'.hermes-home');installStarter(root);fs.mkdirSync(home,{recursive:true});
 if(config)fs.writeFileSync(path.join(home,'config.yaml'),'terminal:\n  cwd: "'+root.replaceAll('\\','/')+'"\nmcp_servers:\n  notebook:\n    url: http://127.0.0.1:47831/mcp\n');
 return {root,home};
}
const STARTING=[['Nightly goal research','15 0 * * *','godspeed-goal-research.py'],['Daily round: choose today\'s work','30 5 * * *','godspeed-daily-round-choose.py'],['Daily round: do the work','0 10,16 * * *','godspeed-daily-round-work.py'],['Deadline reminders','0 8 * * *','godspeed-deadline-reminders.py'],['Weekly check-in','*/15 * * * *','godspeed-coach-talks.py'],['Coach reminders and habit check','*/15 * * * *','godspeed-coach-reminders.py']];

test('a fresh mission control made from the starter starts the daily round, deadline reminders and the weekly check-in with its first goal',async t=>{
 const {root,home}=starterFixture(t),store=new Store(root,{device:'laptop-1'}),hermes=fakeHermes(home);
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'laptop-1',run:hermes.run});
 const result=await scheduler.configure({goal:'Run a fictional 10k on 19 April',timezone:'America/New_York'});
 assert.equal(result.routines.state,'created');
 const jobs=hermes.jobs();
 assert.deepEqual(jobs.map(j=>[j.name,j.schedule_display,j.script]),STARTING,'exactly these, by these names, at these times');
 for(const job of jobs){assert.equal(job.deliver,'local','a computer without Telegram keeps the result');assert.equal(job.failure_deliver,'local');assert.equal(job.workdir,root);}
 assert.equal(jobs.find(j=>j.name==='Weekly check-in').no_agent,false,'the talk is written by the assistant');assert.match(jobs.find(j=>j.name==='Weekly check-in').prompt,/opening a coaching talk/);
 for(const name of ['Daily round: choose today\'s work','Daily round: do the work','Deadline reminders','Coach reminders and habit check'])assert.equal(jobs.find(j=>j.name===name).no_agent,true,name+' runs the original program itself');
 // The nightly goal research runs once a night at 00:15 in the reader's zone, before the 05:30 choice, with a two-hour budget.
 {const names=jobs.map(j=>j.name);assert.ok(names.indexOf('Nightly goal research')<names.indexOf("Daily round: choose today's work"));}
 for(const call of hermes.calls)assert.equal(call.timezone,'America/New_York','in the reader\'s zone');
 assert.equal(hermes.calls[0].home,home,'in this installation\'s own Hermes');
 // The scripts Hermes runs, in its own scripts folder, pointing at this mission control.
 const settings=JSON.parse(fs.readFileSync(path.join(home,'scripts','godspeed-routines.json'),'utf8'));
 assert.equal(settings.root,root);assert.equal(settings.timezone,'America/New_York');assert.equal(settings.bin,path.join(home,'bin'));
 for(const [,,script] of STARTING)assert.match(fs.readFileSync(path.join(home,'scripts',script),'utf8'),/from godspeed_routines import main/);
 assert.ok(fs.existsSync(path.join(home,'scripts','godspeed_routines.py')));
 // The weekly check-in: a coach talk about the goal, on the reader's clock, waiting in the chat.
 const area=fs.readFileSync(path.join(root,'coach','weekly-check-in','area.md'),'utf8');
 assert.match(area,/^RHYTHM: weekly sunday$/m);assert.match(area,/^TIME: 18:00$/m);assert.match(area,/^TONE: gentle$/m);assert.match(area,/^SERVES: run-a-fictional-10k-on-19-april$/m);
 const coach=JSON.parse(fs.readFileSync(path.join(root,'coach','settings.json'),'utf8'));assert.equal(coach.timezone,'America/New_York');assert.equal(coach.talk_delivery,'chat');
 // Hermes' own clock too, for a routine asked for in the chat.
 assert.match(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/^timezone: "America\/New_York"$/m);
 assert.equal(store.get('settings','starting-routines').state,'created',"the mission control's record travels with the folder");
 const here=readMachineRecord(store);assert.equal(here.state,'created');assert.deepEqual(here.jobs.map(j=>j.id),jobs.map(j=>j.id),"and this machine's, beside its Hermes");
 assert.ok(fs.existsSync(path.join(store.state,'starting-routines.json')),"in the machine's own state, which never travels");
 // Settings > Routines says what each one does.
 const query=new QueryService(store);query.nativeHermesHome=home;assert.match(query.rows('jobs').find(j=>j.title==='Deadline reminders').what,/08:00/);
 // Once only: setting up again, ticking, or removing a routine never makes one again.
 await scheduler.configure({goal:'A second fictional goal',timezone:'America/New_York'});
 hermes.write(jobs.filter(j=>j.name!=='Deadline reminders'));scheduler.lastTick=0;await scheduler.tick();
 assert.equal(hermes.jobs().length,5,'a routine the reader removed stays removed');
 assert.equal(hermes.calls.filter(c=>c.args[1]==='create').length,6);
});

test('with Telegram the starting routines deliver there, and the coach talks there as before',async t=>{
 const {root,home}=starterFixture(t),store=new Store(root,{device:'vps'}),hermes=fakeHermes(home);
 await new NativeScheduler(store,{home,executable:'hermes',device:'vps',run:hermes.run}).configure({goal:'Fictional server goal',timezone:'Europe/London',delivery:'telegram'});
 assert.deepEqual([...new Set(hermes.jobs().map(j=>j.deliver))],['telegram']);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'coach','settings.json'),'utf8')).talk_delivery,'messenger');
});

test('nothing is started for a mission control set up before, one whose Hermes has routines, or one not made from the starter',async t=>{
 // Set up before this change: an installation record and no record of starting routines.
 {const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  await scheduler.configure({goal:'Fictional later goal'});await scheduler.tick();
  assert.equal(hermes.jobs().length,0);assert.ok(!store.get('settings','starting-routines'));}
 // Hermes already has routines of its own.
 {const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);hermes.write([{id:'mine',name:'My own brief',enabled:true}]);
  await new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run}).configure({goal:'Fictional goal',timezone:'Europe/Berlin'});
  assert.deepEqual(hermes.jobs().map(j=>j.id),['mine']);assert.equal(store.get('settings','starting-routines').state,'skipped');}
 // An adopted mission control: the owner's own manual and rules, the owner's own recipes, live
 // routines on several machines. Michael's own machines are this case; they get nothing new.
 {const root=fixture(t),home=path.join(root,'.hermes-home');fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# My own mission control\n');fs.writeFileSync(path.join(root,'rules','my-own-rule.md'),'Mine.\n');
  for(const skill of ['next-action','work-item'])fs.mkdirSync(path.join(root,'skills',skill),{recursive:true}),fs.writeFileSync(path.join(root,'skills',skill,'SKILL.md'),'My own '+skill);
  installStarter(root);assert.equal(adoptedMissionControl(root),true);
  const store=new Store(root,{device:'pc'}),hermes=fakeHermes(home),scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  await scheduler.configure({goal:'Fictional adopted goal',timezone:'Europe/Berlin'});
  fileGoal(root,'--status','adopted','--title','Another fictional goal');scheduler.lastTick=0;await scheduler.tick();
  assert.equal(hermes.calls.filter(c=>c.args[1]==='create').length,0,'no new job');assert.ok(!store.get('settings','starting-routines'));
  assert.equal(fs.existsSync(path.join(home,'scripts')),false);assert.equal(fs.existsSync(path.join(root,'coach','weekly-check-in')),false);}
});

test('a goal told in the chat starts the same routines at the next tick, on this computer\'s clock',async t=>{
 const {root,home}=starterFixture(t),store=new Store(root,{device:'pc-1'}),hermes=fakeHermes(home);
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc-1',run:hermes.run});
 await scheduler.tick();assert.equal(hermes.calls.filter(c=>c.args[1]==='create').length,0,'no goal yet, nothing started');
 assert.ok(!store.get('settings','installation'));
 // The chat files the goal with the original tool (starter AGENTS.md: "make this a goal").
 fileGoal(root,'--status','adopted','--title','Fictional chat goal');
 scheduler.lastTick=0;await scheduler.tick();
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 assert.deepEqual(hermes.jobs().map(j=>[j.name,j.schedule_display,j.script]),STARTING);
 assert.equal(store.get('settings','installation').owner,'pc-1');assert.equal(store.get('settings','installation').timezone,zone);
 assert.equal(hermes.calls.find(c=>c.args[1]==='create').timezone,zone);
 assert.match(fs.readFileSync(path.join(root,'coach','weekly-check-in','area.md'),'utf8'),/^SERVES: fictional-chat-goal$/m);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(hermes.jobs().length,6,'and only once');
 // A provisional idea is not a goal: it starts nothing.
 const other=starterFixture(t),otherStore=new Store(other.root,{device:'pc-2'}),otherHermes=fakeHermes(other.home);
 fileGoal(other.root,'--title','Only an idea');
 await new NativeScheduler(otherStore,{home:other.home,executable:'hermes',device:'pc-2',run:otherHermes.run}).tick();assert.equal(otherHermes.jobs().length,0);
});

// A reader starts on a computer, later orders a server that joins the same mission control from
// GitHub (its setup asks no goal) and is chosen to run the routines. The computer's Hermes stops
// firing and nothing copies its routines, so the server makes its own.
test('a server that joins later and takes the routines over gets the starting routines in its own Hermes',async t=>{
 const computer=starterFixture(t),pc=new Store(computer.root,{device:'pc-1'}),pcHermes=fakeHermes(computer.home);
 const pcScheduler=new NativeScheduler(pc,{home:computer.home,executable:'hermes',device:'pc-1',run:pcHermes.run});
 await pcScheduler.configure({goal:'Fictional goal from the computer',timezone:'Europe/Berlin'});
 assert.equal(pcHermes.jobs().length,6);
 // The server's copy of the folder, as GitHub carries it: never the computer's own machine state.
 const serverRoot=fixture(t),serverHome=path.join(serverRoot,'.hermes-home');
 fs.cpSync(computer.root,serverRoot,{recursive:true,filter:source=>!['.godspeed','.hermes-home'].includes(path.basename(source))});
 fs.mkdirSync(serverHome,{recursive:true});fs.writeFileSync(path.join(serverHome,'.env'),'TELEGRAM_BOT_TOKEN=fictional-token\n');
 const server=new Store(serverRoot,{device:'vps'}),serverHermes=fakeHermes(serverHome);
 const serverScheduler=new NativeScheduler(server,{home:serverHome,executable:'hermes',device:'vps',run:serverHermes.run});
 assert.equal(server.get('settings','starting-routines').state,'created','the mission control started its routines');
 assert.equal(readMachineRecord(server),null,'but this machine has none yet');
 await serverScheduler.tick();assert.equal(serverHermes.jobs().length,0,'joined, but not running the routines: nothing');
 // "The server runs the routines".
 await serverScheduler.transfer('vps');await serverScheduler.starting;
 assert.deepEqual(serverHermes.jobs().map(j=>[j.name,j.schedule_display,j.script]),STARTING,'the same routines, in the server\'s own Hermes');
 assert.deepEqual([...new Set(serverHermes.jobs().map(j=>j.deliver))],['telegram'],'to the messenger the server has');
 for(const call of serverHermes.calls.filter(c=>c.args[1]==='create'))assert.equal(call.timezone,'Europe/Berlin','on the reader\'s clock');
 assert.equal(readMachineRecord(server).state,'created');
 assert.equal(fs.readdirSync(path.join(serverRoot,'coach')).filter(n=>n==='weekly-check-in').length,1,'the one weekly check-in, not a second');
 serverScheduler.lastTick=0;await serverScheduler.tick();assert.equal(serverHermes.calls.filter(c=>c.args[1]==='create').length,6,'once');
 // The computer no longer runs them: its Hermes is not ticked.
 pc.save('settings',{id:'installation',owner:'vps'});pcScheduler.lastTick=0;const before=pcHermes.calls.length;await pcScheduler.tick();
 assert.equal(pcHermes.calls.length,before);
 // A server whose Hermes has routines of its own gets none (an adopted mission control gets none
 // anywhere: the test above).
 const busyRoot=fixture(t),busyHome=path.join(busyRoot,'.hermes-home');fs.cpSync(computer.root,busyRoot,{recursive:true,filter:source=>!['.godspeed','.hermes-home'].includes(path.basename(source))});
 const busyHermes=fakeHermes(busyHome);busyHermes.write([{id:'theirs',name:'Their own routine',enabled:true}]);
 const busy=new NativeScheduler(new Store(busyRoot,{device:'vps'}),{home:busyHome,executable:'hermes',device:'vps',run:busyHermes.run});await busy.transfer('vps');await busy.starting;
 assert.deepEqual(busyHermes.jobs().map(j=>j.id),['theirs']);
});

test('the routines are made on the machine that runs them, and a failed start is tried again later',async t=>{
 const {root,home}=starterFixture(t),store=new Store(root,{device:'laptop-1'}),hermes=fakeHermes(home);
 const result=await new NativeScheduler(store,{home,executable:'hermes',device:'laptop-1',run:hermes.run}).configure({goal:'Fictional paired goal',timezone:'Europe/Berlin',owner:'vps'});
 assert.equal(result.routines.state,'pending');assert.equal(hermes.jobs().length,0,'not in this laptop\'s Hermes');
 const server=new NativeScheduler(new Store(root,{device:'vps'}),{home,executable:'hermes',device:'vps',run:hermes.run});await server.tick();
 assert.equal(hermes.jobs().length,6,'the server makes them');
 // Hermes refusing one: the ones made are taken back, and the start waits an hour.
 const next=starterFixture(t),nextStore=new Store(next.root,{device:'pc'}),broken=fakeHermes(next.home,{fail:'Deadline reminders'});
 const failed=await new NativeScheduler(nextStore,{home:next.home,executable:'hermes',device:'pc',run:broken.run}).configure({goal:'Fictional goal',timezone:'Europe/Berlin'});
 assert.equal(failed.routines.state,'pending');assert.equal(broken.jobs().length,0);assert.ok(Date.parse(readMachineRecord(nextStore).retry_after)>Date.now()+3500000);
});
// THE FIRST GOAL AFTER THE GETTING-TO-KNOW-YOU CHAT (17 October 2026, found while the user guide was
// checked against the release of 16 October): on a server the invitation that chat sends is a
// Hermes job, which Hermes keeps for a week after it ran, and on a computer the chat's first
// answer, the city, wrote the installation record. Either way a first goal told afterwards started
// nothing, and so did one told after a morning brief or a reminder was asked for in the chat.
const names=jobs=>jobs.map(j=>j.name);
const STARTING_NAMES=STARTING.map(([name])=>name);
for(const [label,sent] of [['still waits to be sent',false],['went out, and Hermes keeps it for a week',true]]){
 test('on a server, a first goal told in the getting-to-know-you chat starts the routines while its invitation '+label,async t=>{
  const {root,home}=starterFixture(t),store=new Store(root,{device:'vps'}),hermes=fakeHermes(home);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'vps',run:hermes.run});
  // What the Telegram setup's last step leaves on a fresh server when no goal was named (telegram-setup-finish.mjs).
  await store.saveAsync('settings',{id:'installation',owner:'vps',timezone:'Europe/Vienna',delivery:'telegram'});await scheduler.startRoutines({setup:true});
  assert.equal(store.get('settings',FLAG).state,'pending');
  beginContext(store,{ownerName:'Anna'});assert.equal((await scheduleInvite(scheduler,{store,home})).scheduled,true);
  assert.deepEqual(hermes.jobs().map(j=>[j.name,j.schedule.kind]),[[INVITE_JOB,'once']]);
  if(sent){const [invite]=hermes.jobs();hermes.write([{...invite,enabled:false,state:'completed',next_run_at:null,last_run_at:new Date().toISOString(),last_status:'ok',repeat:{times:1,completed:1}}]);}
  fileGoal(root,'--status','adopted','--title','Fictional first goal');
  scheduler.lastTick=0;await scheduler.tick();
  assert.deepEqual(names(hermes.jobs()),[INVITE_JOB,...STARTING_NAMES],'the six routines, beside the invitation');
  assert.equal(store.get('settings',FLAG).state,'created');assert.equal(readMachineRecord(store).state,'created');
  assert.deepEqual([...new Set(hermes.jobs().slice(1).map(j=>j.deliver))],['telegram']);
 });
}

test('on a computer, the city answered first in the getting-to-know-you chat leaves the routines waiting for the first goal, told in the chat or in Settings',async t=>{
 for(const where of ['the chat','Settings']){
  const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  assert.equal((await setTimezone(store,{city:'Vienna',home})).zone,'Europe/Vienna');
  assert.equal(store.get('settings',FLAG)?.state,'pending',where+': the mark of a new mission control waiting for its first goal');
  if(where==='the chat'){fileGoal(root,'--status','adopted','--title','Fictional first goal');scheduler.lastTick=0;await scheduler.tick();}
  else{const result=await scheduler.configure({goal:'Fictional first goal',timezone:'Europe/Berlin'});assert.equal(result.routines?.state,'created',where);}
  assert.deepEqual(hermes.jobs().map(j=>[j.name,j.schedule_display,j.script]),STARTING,where);
  for(const call of hermes.calls.filter(c=>c.args[1]==='create'))assert.equal(call.timezone,'Europe/Vienna',where+': on the clock the city gave');
  assert.match(fs.readFileSync(path.join(root,'coach','weekly-check-in','area.md'),'utf8'),/^SERVES: fictional-first-goal$/m);
  assert.equal(store.get('settings',FLAG).state,'created');
 }
});

// What the assistant makes in Hermes when the reader asks for it in the chat, as the starter's
// recipes and manual have it make them: a routine for a recipe works in this mission control's
// folder; a plain reminder may name no folder at all.
const CHAT_JOBS={
 'a morning brief':root=>({name:'Morning brief',schedule:{kind:'cron',expr:'0 7 * * *'},schedule_display:'0 7 * * *',skill:'morning-brief',skills:['morning-brief'],prompt:'Follow the morning-brief recipe for this mission control.',workdir:root,deliver:'local'}),
 'a research watch':root=>({name:'research watches',schedule:{kind:'cron',expr:'30 6 * * 0'},schedule_display:'30 6 * * 0',skill:'research-watch',skills:['research-watch'],prompt:'Read AGENTS.md, then follow skills/research-watch/SKILL.md for the due watches in watch/.',workdir:root,deliver:'local'}),
 'a reminder every weekday at seven':()=>({name:'Stretch',schedule:{kind:'cron',expr:'0 7 * * 1-5'},schedule_display:'0 7 * * 1-5',prompt:'Remind me to stretch.',workdir:null,deliver:'origin'}),
 'a one-time reminder':()=>({name:'Call the dentist',schedule:{kind:'once',run_at:'2026-10-20T09:00:00+02:00'},schedule_display:'once at 2026-10-20 09:00',repeat:{times:1,completed:0},prompt:'Remind me to call the dentist.',workdir:null,deliver:'origin'}),
};
const chatJob=(job,{created_at=new Date().toISOString(),...more}={})=>({id:'chat-'+job.name.toLowerCase().replace(/\W+/g,'-'),repeat:{times:null,completed:0},...job,enabled:true,state:'scheduled',created_at,next_run_at:null,last_run_at:null,...more});

test('a morning brief, a research watch or a reminder asked for in the chat before the first goal never keeps the routines away',async t=>{
 for(const [what,make] of Object.entries(CHAT_JOBS)){
  const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  await scheduler.tick();// the notebook's first start on this computer
  hermes.write([chatJob(make(root))]);
  fileGoal(root,'--status','adopted','--title','Fictional first goal');
  scheduler.lastTick=0;await scheduler.tick();
  assert.deepEqual(names(hermes.jobs()),[make(root).name,...STARTING_NAMES],what);
  assert.equal(store.get('settings',FLAG).state,'created',what);
 }
 // A one-time job is a reminder, never a routine, even one the reader made before Godspeed came, and
 // so is one Hermes keeps after it ran.
 for(const done of [false,true]){
  const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  hermes.write([chatJob(CHAT_JOBS['a one-time reminder'](root),{created_at:'2026-09-01T07:00:00+02:00',...(done?{enabled:false,state:'completed',last_run_at:'2026-09-02T07:00:00+02:00',repeat:{times:1,completed:1}}:{})})]);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  fileGoal(root,'--status','adopted','--title','Fictional first goal');await scheduler.tick();
  assert.deepEqual(names(hermes.jobs()),['Call the dentist',...STARTING_NAMES],done?'a one-time job that ran':'a one-time job still to run');
 }
});

test('routines the reader had in this Hermes before the mission control came, or that work in another folder, still keep the starting routines away',async t=>{
 const cases=[
  ['made before the notebook first started here',root=>chatJob(CHAT_JOBS['a reminder every weekday at seven'](root),{created_at:'2026-09-01T07:00:00+02:00'})],
  ['made before, for this recipe, in no folder',root=>chatJob({...CHAT_JOBS['a morning brief'](root),workdir:null},{created_at:'2026-09-01T07:00:00+02:00'})],
  ['made later, for another folder',root=>chatJob({...CHAT_JOBS['a morning brief'](root),workdir:path.join(path.dirname(root),'another-project')})],
  ['kept with no date at all',root=>({id:'theirs',name:'Their own routine',enabled:true})],
 ];
 for(const [what,make] of cases){
  const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  if(what.startsWith('made before'))hermes.write([make(root)]);
  await scheduler.tick();
  if(!what.startsWith('made before'))hermes.write([make(root)]);
  fileGoal(root,'--status','adopted','--title','Fictional first goal');
  scheduler.lastTick=0;await scheduler.tick();
  assert.equal(hermes.jobs().length,1,what+': nothing added beside the reader\'s own');
  assert.equal(store.get('settings',FLAG).state,'skipped',what);assert.equal(readMachineRecord(store).state,'skipped',what);
  assert.deepEqual(readMachineRecord(store).because.map(j=>j.name),[make(root).name],what+': the record names the routine that decided it');
 }
});

// The release of 16 October 2026 decided "skipped" for good on machines whose only jobs were made
// for their own mission control, and left a computer whose chat filed the city first with no record
// at all. The next tick after the update makes their routines; a real skip, and a routine the reader
// removed, stay as they were.
test('after the update, a machine whose routines were kept away only by jobs made for its mission control gets them at the next tick',async t=>{
 const decided='2026-10-16T18:00:00.000Z',firstTick='2026-10-16T16:00:00.000Z';
 const before=(store,{state='skipped'}={})=>{
  fs.mkdirSync(store.state,{recursive:true});fs.writeFileSync(path.join(store.state,'routine-results.json'),JSON.stringify({since:firstTick,jobs:{}}));
  store.save('settings',{id:'installation',owner:store.device,timezone:'Europe/Berlin',delivery:'notebook'});
  if(state==='skipped'){writeMachineRecord(store,{state:'skipped',device:store.device,reason:'This machine\'s Hermes already had routines of its own',decided_at:decided});store.save('settings',{id:FLAG,goal:'fictional-first-goal',state:'skipped',reason:'Hermes already had routines of its own',decided_at:decided});}
 };
 const kept=[
  ['the invitation, already sent',root=>({...chatJob({name:INVITE_JOB,schedule:{kind:'once',run_at:'2026-10-16T16:10:00+00:00'},repeat:{times:1,completed:1},script:'godspeed-context-invite.py',no_agent:true,workdir:root,deliver:'telegram'},{created_at:'2026-10-16T16:00:30+00:00'}),enabled:false,state:'completed',last_run_at:'2026-10-16T16:10:05+00:00'})],
  ['a morning brief',root=>chatJob(CHAT_JOBS['a morning brief'](root),{created_at:'2026-10-16T17:00:00+00:00'})],
  ['a reminder asked for in the chat',root=>chatJob(CHAT_JOBS['a reminder every weekday at seven'](root),{created_at:'2026-10-16T17:30:00+00:00'})],
 ];
 for(const [what,make] of kept){
  const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  hermes.write([make(root)]);fileGoal(root,'--status','adopted','--title','Fictional first goal');before(store);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});
  await scheduler.tick();
  assert.deepEqual(names(hermes.jobs()),[make(root).name,...STARTING_NAMES],what);
  assert.equal(store.get('settings',FLAG).state,'created',what);assert.equal(readMachineRecord(store).state,'created',what);
  // Made once: a routine the reader removes afterwards stays removed.
  hermes.write(hermes.jobs().filter(j=>j.name!=='Deadline reminders'));scheduler.lastTick=0;await scheduler.tick();
  assert.equal(hermes.jobs().length,6,what+': a routine the reader removed stays removed');
 }
 // The city filed first by the release of 16 October: an installation record and no record of starting routines.
 {const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  before(store,{state:'none'});writeContext(store,{timezone:'Europe/Berlin',timezone_from:'answer'});
  fileGoal(root,'--status','adopted','--title','Fictional first goal');
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});await scheduler.tick();
  assert.deepEqual(hermes.jobs().map(j=>[j.name,j.schedule_display,j.script]),STARTING,'the city first');assert.equal(store.get('settings',FLAG).state,'created');}
 // A real skip: the reader's own routine from before the mission control came. Looked at once
 // more, it stays, and it is not looked at again when the reader later removes that routine.
 {const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  hermes.write([chatJob({name:'My own brief',schedule:{kind:'cron',expr:'0 6 * * *'},prompt:'My own morning.',workdir:null},{created_at:'2026-09-01T07:00:00+02:00'})]);
  fileGoal(root,'--status','adopted','--title','Fictional first goal');before(store);
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});await scheduler.tick();
  assert.deepEqual(names(hermes.jobs()),['My own brief']);assert.equal(store.get('settings',FLAG).state,'skipped');
  assert.equal(readMachineRecord(store).state,'skipped');assert.ok(readMachineRecord(store).rule,'decided by today\'s rule');
  hermes.write([]);scheduler.lastTick=0;await scheduler.tick();
  assert.equal(hermes.calls.filter(c=>c.args[1]==='create').length,0,'decided once');}
 // Set up before 8 October 2026: its owner answering the city after the update changes nothing.
 {const {root,home}=starterFixture(t),store=new Store(root,{device:'pc'}),hermes=fakeHermes(home);
  store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook',created_at:'2026-10-01T08:00:00.000Z'});
  await setTimezone(store,{city:'Vienna',home});assert.ok(!store.get('settings',FLAG));
  fileGoal(root,'--status','adopted','--title','Fictional later goal');
  const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});await scheduler.tick();
  await scheduler.configure({goal:'Another fictional goal'});
  assert.equal(hermes.jobs().length,0,'an installation set up before stays as it was');assert.ok(!store.get('settings',FLAG));}
});

test('notebook schedule controls call Hermes cron and reflect its job file',async t=>{
 const root=fixture(t),store=new Store(root),home=path.join(root,'.hermes'),calls=[];
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.mkdirSync(path.join(root,'skills/morning-brief'),{recursive:true});fs.writeFileSync(path.join(root,'skills/morning-brief/SKILL.md'),'Fictional skill');
 fs.writeFileSync(path.join(home,'cron/jobs.json'),JSON.stringify([{id:'fixture',name:'Morning brief',enabled:true,state:'scheduled'}]));
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',run:async(exe,args)=>{calls.push({exe,args});return {stdout:''};}});
 await scheduler.control({id:'fixture',paused:true});assert.deepEqual(calls[0],{exe:'hermes',args:['cron','pause','fixture']});
 await scheduler.control({kind:'morning-brief',interval_ms:86400000},{enable:true});assert.ok(calls[1].args.includes('--skill'));assert.ok(calls[1].args.includes('morning-brief'));assert.equal(store.list('jobs').length,0);
});

test('a machine that got the first routines before the nightly research existed gets it once, and never again after the reader removed it',async t=>{
 const {root,home}=starterFixture(t),store=new Store(root,{device:'laptop-1'}),hermes=fakeHermes(home);
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'laptop-1',run:hermes.run});
 await scheduler.configure({goal:'Fictional older goal',timezone:'Europe/Berlin'});
 // An installation from before: no research routine, and no record that it was ever offered.
 hermes.write(hermes.jobs().filter(j=>j.name!=='Nightly goal research'));
 const here=readMachineRecord(store);writeMachineRecord(store,{...here,jobs:here.jobs.filter(j=>j.key!=='research')});
 const creates=()=>hermes.calls.filter(c=>c.args[1]==='create').length,before=creates();
 scheduler.lastTick=0;await scheduler.tick();
 assert.equal(creates(),before+1,'made once');
 assert.deepEqual(hermes.jobs().filter(j=>j.name==='Nightly goal research').map(j=>[j.schedule_display,j.script]),[['15 0 * * *','godspeed-goal-research.py']]);
 assert.ok(readMachineRecord(store).jobs.some(j=>j.key==='research'),'and recorded as offered '+JSON.stringify(readMachineRecord(store).jobs.map(j=>j.key)));
 assert.ok(fs.existsSync(path.join(home,'scripts','godspeed-goal-research.py')));
 hermes.write(hermes.jobs().filter(j=>j.name!=='Nightly goal research'));
 scheduler.lastTick=0;await scheduler.tick();
 assert.equal(creates(),before+1,'a routine the reader removed stays removed');
 // A mission control without the research recipe waits: nothing is made for a recipe it does not have.
 const other=starterFixture(t),otherStore=new Store(other.root,{device:'laptop-2'}),otherHermes=fakeHermes(other.home),otherScheduler=new NativeScheduler(otherStore,{home:other.home,executable:'hermes',device:'laptop-2',run:otherHermes.run});
 await otherScheduler.configure({goal:'Fictional second goal',timezone:'Europe/Berlin'});
 otherHermes.write(otherHermes.jobs().filter(j=>j.name!=='Nightly goal research'));
 const old=readMachineRecord(otherStore);writeMachineRecord(otherStore,{...old,jobs:old.jobs.filter(j=>j.key!=='research')});
 fs.rmSync(path.join(other.root,'skills','goal-research'),{recursive:true,force:true});
 const count=otherHermes.calls.filter(c=>c.args[1]==='create').length;otherScheduler.lastTick=0;await otherScheduler.tick();
 assert.equal(otherHermes.calls.filter(c=>c.args[1]==='create').length,count);
});
