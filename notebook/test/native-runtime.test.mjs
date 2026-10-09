import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {EventEmitter} from 'node:events';import {PassThrough} from 'node:stream';
import {nativeAgent} from '../core/native-agent.mjs';import {NativeScheduler,nativeJobs} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {Domains} from '../core/domains.mjs';import {QueryService} from '../core/query.mjs';
import {execFileSync} from 'node:child_process';import {installStarter,adoptedMissionControl} from '../core/starter-workspace.mjs';import {readMachineRecord} from '../core/starting-routines.mjs';import {runCommand} from '../core/child-process.mjs';
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
 const calls=[],file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).jobs:[],write=jobs=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs}));};
 const run=async(exe,args,options={})=>{
  if(exe!=='hermes')return runCommand(exe,args,options);
  calls.push({args,timezone:options.env?.HERMES_TIMEZONE,home:options.env?.HERMES_HOME});
  const [,verb,...rest]=args;
  if(verb==='create'){
   if(fail&&rest.includes(fail))throw Object.assign(Error('Command failed with exit code 1'),{stderr:'fictional refusal'});
   const flag=name=>{const i=rest.indexOf(name);return i===-1?null:rest[i+1];},noAgent=rest.includes('--no-agent'),prompt=noAgent?null:rest[1];
   const jobs=read();jobs.push({id:'job'+(jobs.length+1),name:flag('--name'),schedule_display:rest[0],prompt,script:flag('--script'),no_agent:noAgent,deliver:flag('--deliver'),failure_deliver:flag('--failure-deliver'),workdir:flag('--workdir'),enabled:true,state:'scheduled',next_run_at:null,last_run_at:null,last_status:null});write(jobs);
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
const STARTING=[['Daily round: choose today\'s work','30 5 * * *','godspeed-daily-round-choose.py'],['Daily round: do the work','0 10,16 * * *','godspeed-daily-round-work.py'],['Deadline reminders','0 8 * * *','godspeed-deadline-reminders.py'],['Weekly check-in','*/15 * * * *','godspeed-coach-talks.py'],['Coach reminders and habit check','*/15 * * * *','godspeed-coach-reminders.py']];

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
 assert.equal(hermes.jobs().length,4,'a routine the reader removed stays removed');
 assert.equal(hermes.calls.filter(c=>c.args[1]==='create').length,5);
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
 scheduler.lastTick=0;await scheduler.tick();assert.equal(hermes.jobs().length,5,'and only once');
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
 assert.equal(pcHermes.jobs().length,5);
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
 serverScheduler.lastTick=0;await serverScheduler.tick();assert.equal(serverHermes.calls.filter(c=>c.args[1]==='create').length,5,'once');
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
 assert.equal(hermes.jobs().length,5,'the server makes them');
 // Hermes refusing one: the ones made are taken back, and the start waits an hour.
 const next=starterFixture(t),nextStore=new Store(next.root,{device:'pc'}),broken=fakeHermes(next.home,{fail:'Deadline reminders'});
 const failed=await new NativeScheduler(nextStore,{home:next.home,executable:'hermes',device:'pc',run:broken.run}).configure({goal:'Fictional goal',timezone:'Europe/Berlin'});
 assert.equal(failed.routines.state,'pending');assert.equal(broken.jobs().length,0);assert.ok(Date.parse(readMachineRecord(nextStore).retry_after)>Date.now()+3500000);
});
test('notebook schedule controls call Hermes cron and reflect its job file',async t=>{
 const root=fixture(t),store=new Store(root),home=path.join(root,'.hermes'),calls=[];
 fs.mkdirSync(path.join(home,'cron'),{recursive:true});fs.mkdirSync(path.join(root,'skills/morning-brief'),{recursive:true});fs.writeFileSync(path.join(root,'skills/morning-brief/SKILL.md'),'Fictional skill');
 fs.writeFileSync(path.join(home,'cron/jobs.json'),JSON.stringify([{id:'fixture',name:'Morning brief',enabled:true,state:'scheduled'}]));
 const scheduler=new NativeScheduler(store,{home,executable:'hermes',run:async(exe,args)=>{calls.push({exe,args});return {stdout:''};}});
 await scheduler.control({id:'fixture',paused:true});assert.deepEqual(calls[0],{exe:'hermes',args:['cron','pause','fixture']});
 await scheduler.control({kind:'morning-brief',interval_ms:86400000},{enable:true});assert.ok(calls[1].args.includes('--skill'));assert.ok(calls[1].args.includes('morning-brief'));assert.equal(store.list('jobs').length,0);
});
