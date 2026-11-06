import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync,execFile,spawnSync,spawn} from 'node:child_process';
import {NativeScheduler,nativeJobs} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {installStarter} from '../core/starter-workspace.mjs';import {readMachineRecord,telegramInHermes,chatAppInHermes,OWNER_CHAT_KEY} from '../core/starting-routines.mjs';import {runCommand} from '../core/child-process.mjs';
import {DatabaseSync} from 'node:sqlite';import {CONNECTION_NOTICE_PREFIX} from '../core/connection-names.mjs';
import {cronCalendar,calendarCron,retimeWhat} from '../core/routine-times.mjs';import {enableKinds,readNotebookRoutines,rememberNotebookRoutine,writeNotebookRoutines,JOURNAL_JOB,CHAT_TIDY_JOB,CHAT_TIDY_SCRIPT,BRIEF_SCRIPT,deliveryFor,CONNECTION_JOB,CONNECTION_WHAT} from '../core/notebook-routines.mjs';
import {personalOperation} from '../core/personal-operations.mjs';import {readArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {acceptUpload} from '../core/phone-health.mjs';

// THE SETTINGS CONTROLS FOR HERMES' ROUTINES, 18 October 2026. Routine times was refused for every
// Hermes routine, Enable routine refused most kinds with "Choose an installed Godspeed skill", Routine
// delivery only saved a setting, results reached Telegram only if Telegram came before the first
// goal, and the journal's check-ins were never scheduled.
const temporary=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-settings-routines-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
// A Hermes stand-in that keeps its jobs the way Hermes does (cron/jobs.json), with create, edit,
// pause, resume and remove; tools/goals.js files the goal for real.
function fakeHermes(home){
 let serial=0;const calls=[],file=path.join(home,'cron','jobs.json'),read=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).jobs:[],write=jobs=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs}));};
 const run=async(exe,args,options={})=>{
  if(exe!=='hermes')return runCommand(exe,args,options);
  calls.push(args);const [,verb,...rest]=args,flag=name=>{const i=rest.indexOf(name);return i===-1?null:rest[i+1];};
  const jobs=read();
  if(verb==='create'){const noAgent=rest.includes('--no-agent');jobs.push({id:'job'+(++serial),name:flag('--name'),schedule:{kind:'cron',expr:rest[0]},schedule_display:rest[0],prompt:noAgent?null:rest[1],script:flag('--script'),skill:flag('--skill'),no_agent:noAgent,deliver:flag('--deliver'),workdir:flag('--workdir'),enabled:true,state:'scheduled',created_at:new Date().toISOString()});write(jobs);}
  if(verb==='edit'){const job=jobs.find(j=>j.id===rest[0]);if(!job)throw Error('Job not found');if(flag('--schedule'))Object.assign(job,{schedule:{kind:'cron',expr:flag('--schedule')},schedule_display:flag('--schedule')});if(flag('--deliver'))job.deliver=flag('--deliver');write(jobs);}
  if(verb==='pause'||verb==='resume'){const job=jobs.find(j=>j.id===rest[0]);job.enabled=verb==='resume';write(jobs);}
  if(verb==='remove')write(jobs.filter(j=>j.id!==rest[0]));
  return {stdout:''};
 };
 return {run,calls,jobs:read,write};
}
async function withGoal(t,{device='pc'}={}){
 const root=temporary(t),home=path.join(root,'.hermes-home');installStarter(root);fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: x\n');
 const store=new Store(root,{device}),hermes=fakeHermes(home),scheduler=new NativeScheduler(store,{home,executable:'hermes',device,run:hermes.run});
 await scheduler.configure({goal:'Run a fictional 10k',timezone:'Europe/Berlin'});
 const job=name=>hermes.jobs().find(j=>j.name===name);
 return {root,home,store,hermes,scheduler,job};
}

test('a routine\'s cron line is the form\'s calendar, and back',()=>{
 assert.deepEqual(cronCalendar('30 5 * * *'),{times:['05:30'],weekdays:[0,1,2,3,4,5,6],month_day:null});
 assert.deepEqual(cronCalendar('0 10,16 * * 1,3,5'),{times:['10:00','16:00'],weekdays:[1,3,5],month_day:null});
 assert.deepEqual(cronCalendar('0 9 15 * *'),{times:['09:00'],weekdays:[0,1,2,3,4,5,6],month_day:15});
 for(const none of ['*/15 * * * *','1440m','0 9-17 * * *',''])assert.equal(cronCalendar(none),null,none);
 assert.equal(calendarCron({times:['06:15']}),'15 6 * * *');
 assert.equal(calendarCron({times:['16:00','09:00'],weekdays:[6,0]}),'0 9,16 * * 0,6');
 assert.equal(calendarCron({time:'07:00',month_day:1,weekdays:[0,1,2,3,4,5,6]}),'0 7 1 * *');
 assert.throws(()=>calendarCron({times:['09:00','16:30']}),/same minutes/);
 assert.throws(()=>calendarCron({times:['25:00']}),/like 07:30/);
 assert.throws(()=>calendarCron({times:['07:00'],weekdays:[1],month_day:3}),/every weekday/);
 assert.equal(retimeWhat('At 10:00 and 16:00 it does the work',['10:00','16:00'],['09:00']),'At 09:00 it does the work');
});

test('Routine times moves the routines a first goal started, and says the new time',async t=>{
 const {store,hermes,scheduler,job,home}=await withGoal(t),domains=new Domains(new QueryService(store));domains.nativeScheduler=scheduler;domains.query.nativeHermesHome=home;
 const rows=domains.query.rows('jobs');
 assert.deepEqual(rows.find(j=>j.title==='Daily round: choose today\'s work').calendar,{times:['05:30'],weekdays:[0,1,2,3,4,5,6],month_day:null},'the form shows the real time');
 // The form sends a routine-change with a calendar, as Settings does.
 await personalOperation(domains,{type:'routine-change',id:job('Daily round: choose today\'s work').id,calendar:{times:['06:15'],weekdays:[1,2,3,4,5]}});
 assert.equal(job('Daily round: choose today\'s work').schedule.expr,'15 6 * * 1,2,3,4,5');
 assert.match(readMachineRecord(store).jobs.find(j=>j.key==='decide').what,/at 06:15 it picks/);
 await personalOperation(domains,{type:'routine-change',id:job('Daily round: do the work').id,calendar:{times:['09:00','17:00']}});
 assert.equal(job('Daily round: do the work').schedule.expr,'0 9,17 * * *');
 assert.match(readMachineRecord(store).jobs.find(j=>j.key==='work').what,/^At 09:00 and 17:00/);
 // The weekly check-in moves its talk: the coach opens it on Saturdays at six.
 await personalOperation(domains,{type:'routine-change',id:job('Weekly check-in').id,calendar:{times:['18:00'],weekdays:[6]}});
 const area=readArea(path.join(store.root,'coach','weekly-check-in'));assert.equal(area.rhythmText,'weekly saturday');assert.equal(area.time,'18:00');
 assert.equal(job('Weekly check-in').schedule.expr,'*/15 * * * *','its Hermes job still looks every 15 minutes');
 assert.match(readMachineRecord(store).jobs.find(j=>j.key==='coach-gate').what,/every Saturday at 18:00/);
 assert.deepEqual(new QueryService(store).rows&&(()=>{const q=new QueryService(store);q.nativeHermesHome=home;return q.rows('jobs').find(j=>j.title==='Weekly check-in').calendar;})(),{times:['18:00'],weekdays:[6],month_day:null});
 // The coach's reminders have no time of their own, and say so.
 await assert.rejects(personalOperation(domains,{type:'routine-change',id:job('Coach reminders and habit check').id,calendar:{times:['09:00']}}),/no time of its own/);
 assert.ok(!hermes.calls.some(c=>c[1]==='edit'&&c[2]===job('Coach reminders and habit check').id));
});

test('Enable routine offers the mission control\'s own recipes by name, and Hermes runs them',async t=>{
 const {root,store,hermes,scheduler}=await withGoal(t);
 // The starter's recipes, and the notebook's packaged ones (installed by godspeed init, two here).
 for(const name of ['mc-radar','audit']){fs.mkdirSync(path.join(root,'skills',name),{recursive:true});fs.writeFileSync(path.join(root,'skills',name,'SKILL.md'),'# '+name);}
 assert.deepEqual(enableKinds(root),[{kind:'morning-brief',label:'Morning brief'},{kind:'review',label:'Weekly review'},{kind:'research-watch',label:'Research watches'},{kind:'radar',label:'AI radar'},{kind:'audit',label:'Mission control audit'}]);
 fs.rmSync(path.join(root,'skills','audit'),{recursive:true,force:true});assert.ok(!enableKinds(root).some(k=>k.kind==='audit'),'a recipe that is not here is not offered');
 const row=await scheduler.control({kind:'review',at:'17:00'},{enable:true});
 const made=hermes.jobs().find(j=>j.id===row.id);
 assert.equal(made.name,'Weekly review');assert.equal(made.skill,'weekly-review');assert.equal(made.schedule.expr,'0 17 * * *');assert.equal(made.workdir,store.root);assert.equal(made.deliver,'local');
 assert.match(made.prompt,/weekly-review recipe/);
 assert.ok(readNotebookRoutines(store).jobs.some(j=>j.id===made.id&&j.what),'its row says what it does');
 await assert.rejects(scheduler.control({kind:'review',at:'18:00'},{enable:true}),/already runs/);
 await assert.rejects(scheduler.control({kind:'audit',at:'18:00'},{enable:true}),/does not have the recipe/);
});

test('results go to Telegram whenever Telegram is connected, whatever came first, and Keep results here keeps them here',async t=>{
 const {home,store,hermes,scheduler,job}=await withGoal(t,{device:'vps'});
 const mine=()=>[...readMachineRecord(store).jobs.map(j=>j.id)].map(id=>hermes.jobs().find(j=>j.id===id).deliver);
 assert.ok(mine().every(d=>d==='local'),'no Telegram at the first goal: results are kept here');
 // Telegram is connected after the first goal.
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_HOME_CHANNEL=42\n');
 await scheduler.followDelivery();
 assert.ok(mine().every(d=>d==='telegram'),'every starting routine now delivers to Telegram');
 assert.equal(readMachineRecord(store).delivery,'telegram');
 assert.equal(JSON.parse(fs.readFileSync(path.join(store.root,'coach','settings.json'),'utf8')).talk_delivery,'messenger','the weekly check-in is sent, not left waiting in the chat');
 // A routine asked for in the chat answers where it was asked, and is left alone.
 const jobs=hermes.jobs();jobs.push({id:'chat1',name:'Plan my day',deliver:'origin',enabled:true});hermes.write(jobs);
 // Pressing "Keep results here" keeps them here.
 store.save('settings',{id:'installation',delivery:'notebook',delivery_chosen_at:new Date().toISOString()});
 await scheduler.followDelivery();
 assert.ok(mine().every(d=>d==='local'));assert.equal(hermes.jobs().find(j=>j.id==='chat1').deliver,'origin');
 assert.equal(deliveryFor({delivery:'telegram',delivery_chosen_at:'x'},{telegram:false}),'local','Telegram chosen but not connected keeps them here until it is');
 assert.equal(job('Deadline reminders').deliver,'local');
});

test('the journal\'s check-ins are scheduled once any of them is switched on, on the person\'s clock, and paused when all are off',async t=>{
 const {root,home,store,hermes,scheduler}=await withGoal(t);
 const journal=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
 const set=(key,value)=>execFileSync(process.execPath,[journal,'config','set',key,value,'--godspeed',root],{env:{...process.env,GODSPEED_JOURNAL_GIT_SYNC:'off'},windowsHide:true});
 const mine=()=>hermes.jobs().find(j=>j.name===JOURNAL_JOB);
 await scheduler.followJournal();assert.equal(mine(),undefined,'nothing while every check-in is off, as they start');
 set('nudge.enabled','on');
 await scheduler.followJournal();
 const made=mine();assert.ok(made,'switched on in the chat: the routine exists');
 assert.equal(made.schedule.expr,'*/15 * * * *');assert.equal(made.script,'godspeed-journal-checkins.py');assert.equal(made.no_agent,true);assert.equal(made.workdir,root);
 assert.match(fs.readFileSync(path.join(home,'scripts','godspeed-journal-checkins.py'),'utf8'),/main\("journal-tick"\)/);
 const config=JSON.parse(fs.readFileSync(path.join(home,'scripts','godspeed-routines.json'),'utf8'));assert.ok(config.journal.endsWith('godspeed-journal.mjs'));
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'routines','journal','settings.json'),'utf8')).timezone,'Europe/Berlin','the journal reads its times on the person\'s clock');
 const q=new QueryService(store);q.nativeHermesHome=home;assert.match(q.rows('jobs').find(j=>j.title===JOURNAL_JOB).what,/check-ins/);
 await scheduler.followJournal();assert.equal(hermes.jobs().filter(j=>j.name===JOURNAL_JOB).length,1,'once');
 set('nudge.enabled','off');await scheduler.followJournal();assert.equal(mine().enabled,false,'all off: paused');
 set('evening.enabled','on');await scheduler.followJournal();assert.equal(mine().enabled,true,'one on again: resumed');
 // A routine the person removed stays removed.
 hermes.write(hermes.jobs().filter(j=>j.name!==JOURNAL_JOB));await scheduler.followJournal();assert.equal(mine(),undefined);
});

test('the mail counts are scheduled while a tracker has a mail rule, stay on this machine, and are paused when none has',async t=>{
 const {root,home,store,hermes,scheduler}=await withGoal(t);
 const mine=()=>hermes.jobs().find(j=>j.name==='Mail counts');
 await scheduler.followMailCount();assert.equal(mine(),undefined,'no rule: no routine');
 const rule={senders:['shop.example.invalid'],subjects:['order'],mailbox:'gmail'};
 const tracker=store.save('collections',{name:'Orders',field_schema:[],tracker:{names:['Orders'],cadence:'any',talks:[],specialist:null,mail:rule}});
 await scheduler.followMailCount();
 const made=mine();assert.ok(made,'a rule: the routine exists');
 assert.equal(made.schedule.expr,'30 4 * * *');assert.equal(made.script,'godspeed-mail-count.py');assert.equal(made.no_agent,true);assert.equal(made.deliver,'local');assert.equal(made.workdir,root);
 assert.match(fs.readFileSync(path.join(home,'scripts','godspeed-mail-count.py'),'utf8'),/main\("mail-count"\)/);
 const q=new QueryService(store);q.nativeHermesHome=home;assert.match(q.rows('jobs').find(j=>j.title==='Mail counts').what,/never reads a mail's text and sends nothing/);
 store.save('settings',{id:'installation',timezone:'Europe/Berlin',delivery:'telegram'});
 await scheduler.followDelivery();assert.equal(mine().deliver,'local','it never sends, whatever the others deliver');
 await scheduler.followMailCount();assert.equal(hermes.jobs().filter(j=>j.name==='Mail counts').length,1,'once');
 store.save('collections',{...tracker,tracker:{...tracker.tracker,mail:undefined}});
 await scheduler.followMailCount();assert.equal(mine().enabled,false,'no rule left: paused');
 store.save('collections',tracker);await scheduler.followMailCount();assert.equal(mine().enabled,true,'a rule again: resumed');
 hermes.write(hermes.jobs().filter(j=>j.name!=='Mail counts'));await scheduler.followMailCount();assert.equal(mine(),undefined,'removed by the person: not made again');
});

test('a mail-count routine Hermes cannot make is a pending notice after a periodic tick, resolved once it is made',async t=>{
 const {store,scheduler}=await withGoal(t);
 store.save('collections',{name:'Orders',field_schema:[],tracker:{names:['Orders'],cadence:'any',talks:[],specialist:null,mail:{senders:['shop.example.invalid'],subjects:['order'],mailbox:'gmail'}}});
 const command=scheduler.command.bind(scheduler);
 scheduler.command=async(args,...rest)=>{if(args[0]==='create')throw Error('hermes is down');return command(args,...rest);};
 const pending=()=>store.list('notifications').filter(n=>n.id==='mail-count-routine'&&n.status==='pending');
 scheduler.lastTick=0;await scheduler.tick();
 scheduler.lastTick=0;await scheduler.tick();
 assert.equal(pending().length,1);assert.match(pending()[0].body,/mail rules are not counting/);
 scheduler.command=command;scheduler.lastTick=0;await scheduler.tick();
 assert.equal(store.get('notifications','mail-count-routine').status,'resolved');
});

test('the routine scripts run the journal\'s tick and say a queued notice once',{skip:!['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}})&&'needs Python'},async t=>{
 const {root,home,store,scheduler}=await withGoal(t);
 const journal=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
 execFileSync(process.execPath,[journal,'config','set','nudge.enabled','on','--godspeed',root],{env:{...process.env,GODSPEED_JOURNAL_GIT_SYNC:'off'},windowsHide:true});
 await scheduler.followJournal();
 const {queueNotice}=await import('../core/notices.mjs');queueNotice(store,{id:'backup-1',text:'Last night\'s backup failed.'});
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const run=()=>execFileSync(python,[path.join(home,'scripts','godspeed-journal-checkins.py')],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true});
 assert.equal(run().trim(),'Last night\'s backup failed.','the notice, and the journal had nothing due');
 assert.equal(run().trim(),'','said once');
 const sent=()=>store.list('conversation_messages').filter(m=>m.source_app==='background');
 assert.deepEqual(sent().map(m=>[m.content,m.report.written]),[['Last night\'s backup failed.','fallback']],'said with no AI, and recorded');
});

test('a notice that cannot be recorded is not said or marked said, and goes out once recording works',{skip:!['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}})&&'needs Python'},async t=>{
 const {root,home,store,scheduler}=await withGoal(t);
 const journal=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
 execFileSync(process.execPath,[journal,'config','set','nudge.enabled','on','--godspeed',root],{env:{...process.env,GODSPEED_JOURNAL_GIT_SYNC:'off'},windowsHide:true});
 await scheduler.followJournal();
 const {queueNotice}=await import('../core/notices.mjs');queueNotice(store,{id:'backup-1',text:'Last night\'s backup failed.'});
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const configFile=path.join(home,'scripts','godspeed-routines.json'),good=fs.readFileSync(configFile,'utf8');
 fs.writeFileSync(configFile,JSON.stringify({...JSON.parse(good),reports:path.join(root,'missing.mjs')}));
 const run=()=>spawnSync(python,[path.join(home,'scripts','godspeed-journal-checkins.py')],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true});
 const failed=run();assert.notEqual(failed.status,0);assert.equal(failed.stdout,'');assert.match(failed.stderr,/could not be recorded/);
 assert.equal(fs.existsSync(path.join(home,'godspeed-notices-said.json')),false,'not marked said');
 fs.writeFileSync(configFile,good);
 const again=run();assert.equal(again.status,0,again.stderr);assert.equal(again.stdout.trim(),'Last night\'s backup failed.');
});

test('two queued notices are said one in each run',{skip:!['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}})&&'needs Python'},async t=>{
 const {root,home,store,scheduler}=await withGoal(t);
 const journal=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
 execFileSync(process.execPath,[journal,'config','set','nudge.enabled','on','--godspeed',root],{env:{...process.env,GODSPEED_JOURNAL_GIT_SYNC:'off'},windowsHide:true});
 await scheduler.followJournal();
 const {queueNotice}=await import('../core/notices.mjs');queueNotice(store,{id:'a-1',text:'First thing.'});queueNotice(store,{id:'b-1',text:'Second thing.'});
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const run=()=>execFileSync(python,[path.join(home,'scripts','godspeed-journal-checkins.py')],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true}).trim();
 assert.deepEqual([run(),run(),run()],['First thing.','Second thing.','']);
});

// THE DAILY CONNECTION CHECK (#200, 4 November 2026): a script routine at 05:00 (earlier before an early Morning brief), on when Telegram,
// Gmail, a mail rule or phone health data is present and paused when none is; Settings > Routines lists it with its switch.
const noMail=t=>{const was=process.env.GODSPEED_MAIL_HOME,dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-no-mail-'));process.env.GODSPEED_MAIL_HOME=dir;t.after(()=>{if(was===undefined)delete process.env.GODSPEED_MAIL_HOME;else process.env.GODSPEED_MAIL_HOME=was;fs.rmSync(dir,{recursive:true,force:true});});};
test('the daily connection check is listed with its switch, paused until a connection is set up',async t=>{
 noMail(t);
 const {root,home,store,hermes,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();
 const made=job(CONNECTION_JOB);assert.ok(made,'made beside the starting routines');
 assert.equal(made.schedule.expr,'0 5 * * *');assert.equal(made.script,'godspeed-connection-check.py');assert.equal(made.no_agent,true);assert.equal(made.workdir,root);assert.equal(made.enabled,false,'neither is connected: made paused');
 assert.match(fs.readFileSync(path.join(home,'scripts','godspeed-connection-check.py'),'utf8'),/main\("connection-check"\)/);
 assert.ok(JSON.parse(fs.readFileSync(path.join(home,'scripts','godspeed-routines.json'),'utf8')).connection_check.endsWith('connection-check.mjs'));
 const q=new QueryService(store);q.nativeHermesHome=home;
 const row=q.rows('jobs').find(j=>j.title===CONNECTION_JOB);assert.match(row.what,/phone has not sent health data for 36 hours/);assert.equal(row.paused,true);
 // Telegram connected later: the notebook, which paused it, resumes it.
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,true);
 // The last connection removed while it still runs as the notebook left it: the notebook pauses it, and resumes it when one returns.
 fs.writeFileSync(path.join(home,'.env'),'');
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,false);
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,true);
 // The person pauses it: it stays paused, with Telegram connected.
 const domains=new Domains(q);domains.nativeScheduler=scheduler;
 await personalOperation(domains,{type:'routine-change',id:made.id,paused:true});assert.equal(job(CONNECTION_JOB).enabled,false);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,false);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,false);
 // Removed: stays removed.
 hermes.write(hermes.jobs().filter(j=>j.name!==CONNECTION_JOB));scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB),undefined);
});

test('a mail rule alone starts the daily connection check on, so its failed searches reach the owner',async t=>{
 noMail(t);
 const {store,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,false);
 store.save('collections',{name:'Orders',field_schema:[],tracker:{names:['Orders'],cadence:'any',talks:[],specialist:null,mail:{senders:['shop.example.invalid'],subjects:['order'],mailbox:'godspeed'}}});
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,true);
});

test('an accepted phone upload alone starts the daily connection check',async t=>{
 noMail(t);
 const {store,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,false);
 acceptUpload(store,{metrics:[]},{now:new Date('2026-11-04T10:00:00Z')});
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,true);
});

test('an existing daily connection check refreshes its Settings description',async t=>{
 noMail(t);
 const {home,store,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();
 const existing=readNotebookRoutines(store).jobs.find(j=>j.key==='connection-check');rememberNotebookRoutine(store,{...existing,what:'Checks the connections you set up.'});
 scheduler.lastTick=0;await scheduler.tick();
 const refreshed=readNotebookRoutines(store).jobs.find(j=>j.key==='connection-check');assert.equal(refreshed.what,CONNECTION_WHAT);assert.equal(refreshed.paused_by_notebook,true,'the upgrade keeps the notebook-owned pause');
 const q=new QueryService(store);q.nativeHermesHome=home;assert.equal(q.rows('jobs').find(j=>j.title===CONNECTION_JOB).what,CONNECTION_WHAT);assert.equal(job(CONNECTION_JOB).enabled,false);
});

test('an active notebook-owned daily connection check refreshes its Settings description',async t=>{
 noMail(t);
 const {home,store,scheduler,job}=await withGoal(t);
 acceptUpload(store,{metrics:[]},{now:new Date('2026-11-04T10:00:00Z')});
 scheduler.lastTick=0;await scheduler.tick();
 const existing=readNotebookRoutines(store).jobs.find(j=>j.key==='connection-check');assert.equal(existing.paused_by_notebook,false);assert.equal(existing.running_by_notebook,true);assert.equal(job(CONNECTION_JOB).enabled,true);
 rememberNotebookRoutine(store,{...existing,what:'Checks the connections you set up.'});
 scheduler.lastTick=0;await scheduler.tick();
 const refreshed=readNotebookRoutines(store).jobs.find(j=>j.key==='connection-check');assert.equal(refreshed.what,CONNECTION_WHAT);assert.equal(refreshed.paused_by_notebook,false,'the upgrade keeps the notebook-owned active state');assert.equal(refreshed.running_by_notebook,true);
 const q=new QueryService(store);q.nativeHermesHome=home;assert.equal(q.rows('jobs').find(j=>j.title===CONNECTION_JOB).what,CONNECTION_WHAT);assert.equal(job(CONNECTION_JOB).enabled,true);
});

test('a Morning brief set early brings the daily connection check ahead of it, and a failed creation reaches the setup tick',async t=>{
 noMail(t);
 const {store,home,hermes,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).schedule.expr,'0 5 * * *');
 await scheduler.setNotifications({daily:{enabled:true,time:'04:30'}});
 assert.equal(job(CONNECTION_JOB).schedule.expr,'0 4 * * *','before a 04:30 brief');
 await scheduler.setNotifications({daily:{enabled:true,time:'00:10'}});
 assert.equal(job(CONNECTION_JOB).schedule.expr,'40 23 * * *','before a 00:10 brief');
 await scheduler.setNotifications({daily:{enabled:true,time:'07:00'}});
 assert.equal(job(CONNECTION_JOB).schedule.expr,'0 5 * * *','a later brief gives the check its usual time back');
 await scheduler.setNotifications({daily:{enabled:true,time:'09:00'}});
 hermes.write(hermes.jobs().filter(j=>j.name!==CONNECTION_JOB));writeNotebookRoutines(store,{...readNotebookRoutines(store),jobs:readNotebookRoutines(store).jobs.filter(j=>j.key!=='connection-check')});
 const failing=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:async(exe,args,options)=>{if(args[1]==='create'&&args.includes(CONNECTION_JOB))throw Error('Hermes could not create it');return hermes.run(exe,args,options);}});
 await failing.tick();failing.lastTick=0;assert.equal(job(CONNECTION_JOB),undefined,'a periodic tick swallows it');
 await assert.rejects(failing.tick({raise:true}),/could not create it/);
 // The cooldown from the tick above is still running: the setup hears it too.
 await assert.rejects(failing.tick({raise:true}),/could not create it/);
});

test('a failed creation of the night chat tidy-up reaches the setup tick, and a periodic tick reports it',async t=>{
 const {store,home,hermes,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_HOME_CHANNEL=42\n');
 const failing=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:async(exe,args,options)=>{if(args[1]==='create'&&args.includes(CHAT_TIDY_JOB))throw Error('Hermes could not create it');return hermes.run(exe,args,options);}});
 const reported=[];failing.onFailure=error=>reported.push(error.message);
 await failing.tick();failing.lastTick=0;assert.equal(job(CHAT_TIDY_JOB),undefined);
 assert.match(reported.join(),/could not create it/,'a periodic tick reports it');
 await assert.rejects(failing.tick({raise:true}),/could not create it/);
});

test('two periodic creation failures in one tick are both reported',async t=>{
 const {store,home,hermes,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_HOME_CHANNEL=42\n');
 hermes.write(hermes.jobs().filter(j=>j.name!==CONNECTION_JOB));writeNotebookRoutines(store,{...readNotebookRoutines(store),jobs:readNotebookRoutines(store).jobs.filter(j=>j.key!=='connection-check')});
 const failing=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:async(exe,args,options)=>{if(args[1]==='create'&&(args.includes(CONNECTION_JOB)||args.includes(CHAT_TIDY_JOB)))throw Error('could not create '+(args.includes(CHAT_TIDY_JOB)?'chat-tidy':'connection'));return hermes.run(exe,args,options);}});
 const reported=[];failing.onFailure=error=>reported.push(error.message);
 await failing.tick();
 assert.deepEqual(reported.sort(),['could not create chat-tidy','could not create connection']);
});

test('the running service logs a routine that could not be created, and its tick still ends',async t=>{
 const root=temporary(t),home=path.join(root,'.hermes-home');installStarter(root);fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: x\n');
 const assistant=path.join(root,'assistant-test.json');fs.writeFileSync(assistant,JSON.stringify({verified:true,executable:'hermes',home}));
 const saved={runtime:process.env.GODSPEED_ORIGINAL_RUNTIME,config:process.env.GODSPEED_ASSISTANT_CONFIG};
 process.env.GODSPEED_ORIGINAL_RUNTIME='on';process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 t.after(()=>{for(const [name,value] of [['GODSPEED_ORIGINAL_RUNTIME',saved.runtime],['GODSPEED_ASSISTANT_CONFIG',saved.config]])if(value===undefined)delete process.env[name];else process.env[name]=value;});
 const {createService}=await import('../server/main.mjs');
 const service=await createService({root,port:0});t.after(()=>service.close());
 const hermes=fakeHermes(home);
 service.scheduler.run=async(exe,args,options)=>{if(args[1]==='create'&&args.includes(CHAT_TIDY_JOB))throw Error('Hermes could not create it');return hermes.run(exe,args,options);};
 await service.scheduler.configure({goal:'Run a fictional 10k',timezone:'Europe/Berlin'});
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_HOME_CHANNEL=42\n');
 const logged=[],original=console.error;console.error=(...line)=>{logged.push(line.join(' '));};
 try{service.scheduler.lastTick=0;await service.scheduler.tick();}finally{console.error=original;}
 assert.ok(logged.some(line=>/could not be created, the next tick tries again.*could not create it/.test(line)),logged.join('\n'));
});

test('a setup that overlaps the running periodic tick still hears its failed connection-check creation',async t=>{
 noMail(t);
 const {store,home,hermes,job}=await withGoal(t);
 let entered,release;const inside=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const failing=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:async(exe,args,options)=>{if(args[1]==='create'&&args.includes(CONNECTION_JOB)){entered();await gate;throw Error('Hermes could not create it');}return hermes.run(exe,args,options);}});
 const periodic=failing.tick();
 await inside;
 const setup=assert.rejects(failing.tick({raise:true}),/could not create it/);
 release();
 await Promise.all([periodic,setup]);
 assert.equal(job(CONNECTION_JOB),undefined);
});

test('a Morning brief already at 04:30 when the daily connection check is first made puts the check ahead of it',async t=>{
 noMail(t);
 const {scheduler,job}=await withGoal(t);
 await scheduler.setNotifications({daily:{enabled:true,time:'04:30'}});
 assert.equal(job(CONNECTION_JOB),undefined,'not made yet');
 scheduler.lastTick=0;await scheduler.tick();
 assert.equal(job(CONNECTION_JOB).schedule.expr,'0 4 * * *');
});

test('Gmail alone, read through the real mail adapter, starts the daily connection check on',async t=>{
 const mail=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-gmail-only-')),was=process.env.GODSPEED_MAIL_HOME;
 fs.mkdirSync(path.join(mail,'.godspeed','mail','imap'),{recursive:true});
 fs.writeFileSync(path.join(mail,'.godspeed','mail','imap','state.json'),JSON.stringify({address:'someone@example.invalid',state:'ready'}));
 process.env.GODSPEED_MAIL_HOME=mail;
 t.after(()=>{if(was===undefined)delete process.env.GODSPEED_MAIL_HOME;else process.env.GODSPEED_MAIL_HOME=was;fs.rmSync(mail,{recursive:true,force:true});});
 const {home,scheduler,job}=await withGoal(t);
 assert.equal(telegramInHermes(home),false);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,true);
});

test('a person who resumes the daily connection check keeps it on, and one with Telegram from the start gets it on',async t=>{
 noMail(t);
 const {home,store,scheduler,job}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,false);
 const q=new QueryService(store);q.nativeHermesHome=home;const domains=new Domains(q);domains.nativeScheduler=scheduler;
 await personalOperation(domains,{type:'routine-change',id:job(CONNECTION_JOB).id,paused:false});assert.equal(job(CONNECTION_JOB).enabled,true);
 scheduler.lastTick=0;await scheduler.tick();assert.equal(job(CONNECTION_JOB).enabled,true);
 assert.equal(readNotebookRoutines(store).jobs.find(j=>j.key==='connection-check').paused_by_notebook,false,'the notebook no longer thinks it is theirs to resume');
 // A fresh machine whose Hermes already has a Telegram bot.
 const other=temporary(t),otherHome=path.join(other,'.hermes-home');installStarter(other);fs.mkdirSync(otherHome,{recursive:true});fs.writeFileSync(path.join(otherHome,'config.yaml'),'model:\n  default: x\n');fs.writeFileSync(path.join(otherHome,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 const otherStore=new Store(other,{device:'pc'}),otherHermes=fakeHermes(otherHome),otherScheduler=new NativeScheduler(otherStore,{home:otherHome,executable:'hermes',device:'pc',run:otherHermes.run});
 await otherScheduler.configure({goal:'Run a fictional 10k',timezone:'Europe/Berlin'});otherScheduler.lastTick=0;await otherScheduler.tick();
 const made=otherHermes.jobs().find(j=>j.name===CONNECTION_JOB);assert.ok(made);assert.notEqual(made.enabled,false,'Telegram connected: on from the start');assert.equal(made.deliver,'telegram');
 fs.writeFileSync(path.join(otherHome,'.env'),'');otherScheduler.lastTick=0;await otherScheduler.tick();
 assert.equal(otherHermes.jobs().find(j=>j.name===CONNECTION_JOB).enabled,false,'made running by the notebook, it goes off with the last connection');
});

test('the daily connection check\'s script says what the check queued, once',{skip:!['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}})&&'needs Python'},async t=>{
 noMail(t);
 const {root,home,store,scheduler}=await withGoal(t);
 scheduler.lastTick=0;await scheduler.tick();
 const stand=path.join(root,'stand-in-check.mjs');
 fs.writeFileSync(stand,"import {Store} from '"+new URL('../core/records/store.mjs',import.meta.url).href+"';import {queueNotice} from '"+new URL('../core/notices.mjs',import.meta.url).href+"';queueNotice(new Store(process.env.GODSPEED_WORKSPACE,{device:'pc'}),{id:'"+CONNECTION_NOTICE_PREFIX+"telegram-2026-11-04',text:'Telegram refused your bot key.'});");
 const file=path.join(home,'scripts','godspeed-routines.json');fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),connection_check:stand}));
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const run=()=>execFileSync(python,[path.join(home,'scripts','godspeed-connection-check.py')],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true});
 assert.equal(run().trim(),'Telegram refused your bot key.');
 assert.equal(run().trim(),'','said once');
});

// THE NIGHT CHAT TIDY-UP IS GIVEN TO EVERY INSTALL WITH A CHAT APP (notebook-routines.mjs).
test('an install with a chat app connected gets the night chat tidy-up at 01:30, once; one without gets none',async t=>{
 const {store,home,hermes,scheduler}=await withGoal(t);
 const mine=()=>hermes.jobs().filter(j=>j.name===CHAT_TIDY_JOB);
 scheduler.lastTick=0;await scheduler.tick().catch(()=>null);
 assert.equal(chatAppInHermes(home),false);
 assert.equal(mine().length,0,'no chat app, no routine');
 assert.ok(!readNotebookRoutines(store).jobs.some(j=>j.key==='chat-tidy'));
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\nTELEGRAM_HOME_CHANNEL=42\n');
 scheduler.lastTick=0;await scheduler.tick().catch(()=>null);
 assert.equal(mine().length,1);
 assert.equal(mine()[0].schedule.expr,'30 1 * * *');
 assert.equal(mine()[0].script,CHAT_TIDY_SCRIPT);assert.equal(mine()[0].no_agent,true);
 assert.equal(mine()[0].deliver,'local','its results are never delivered to the chat');
 assert.ok(readNotebookRoutines(store).jobs.some(j=>j.key==='chat-tidy'&&j.id===mine()[0].id));
 scheduler.lastTick=0;await scheduler.tick().catch(()=>null);
 assert.equal(mine().length,1,'made once');
 assert.equal(mine()[0].deliver,'local','and still not moved to Telegram by the delivery follow-up');
 // Removed by the person: it stays removed.
 hermes.write(hermes.jobs().filter(j=>j.name!==CHAT_TIDY_JOB));
 scheduler.lastTick=0;await scheduler.tick().catch(()=>null);
 assert.equal(mine().length,0);
});

// What the night chat tidy-up will count as a chat app (starting-routines.mjs, chatAppInHermes).
test("a chat app is any app the gateway routes the owner's own chat through, never a group or the terminal",async t=>{
 const {home}=await withGoal(t);
 assert.equal(chatAppInHermes(home),false,'no chat app at all');
 // What this Hermes has is no Telegram bot, but a private chat the gateway routes through another
 // app: the shape the routine itself reads the table for (agent:main:<app>:dm:<id>).
 const db=new DatabaseSync(path.join(home,'state.db'));
 db.exec('create table gateway_routing(scope text, session_key text, entry_json text)');
 const route=(key,id)=>db.prepare('insert into gateway_routing values (?,?,?)').run(path.join(home,'sessions'),key,JSON.stringify({session_id:id}));
 route('agent:main:telegram:group:8','a-group-chat');
 assert.equal(chatAppInHermes(home),false,"a group chat is not the owner's own chat");
 route('agent:main:local:dm:local-1','a-conversation-in-the-terminal');
 assert.equal(chatAppInHermes(home),false,"the assistant's own terminal is no chat app");
 for(const own of ['cli','tui','cron','webhook','api_server'])route('agent:main:'+own+':dm:1','not-a-chat-'+own);
 assert.equal(chatAppInHermes(home),false,'the five non-chat entry points are no chat app');
 route('agent:main:signal:dm:7','the-owners-chat');
 db.close();
 assert.equal(telegramInHermes(home),false,'still no Telegram bot in Hermes');
 assert.equal(chatAppInHermes(home),true);
});

test("the scheduler and the installed godspeed-chat-tidy plugin classify the owner's chat from one vocabulary",()=>{
 const plugin=fs.readFileSync(fileURLToPath(new URL('../assistant-files/godspeed-chat-tidy/__init__.py',import.meta.url)),'utf8');
 const pattern=plugin.match(/^CHAT_KEY = r"(.+)"$/m)?.[1];
 const excluded=plugin.match(/^NOT_A_CHAT_APP = \((.+)\)$/m)?.[1].split(',').map(name=>name.trim().replace(/"/g,''));
 assert.equal(pattern,OWNER_CHAT_KEY.source,'the plugin and the scheduler declare the same pattern');
 assert.ok(excluded?.length>0);
 for(const name of excluded)assert.equal(OWNER_CHAT_KEY.test('agent:main:'+name+':dm:1'),false,name+' is no chat app');
 assert.equal(OWNER_CHAT_KEY.test('agent:main:signal:dm:1'),true);
});

test('/radar and /subs are short names for their recipes in Telegram, and an owner\'s own short name stays',async()=>{
 const {godspeedHermesSettings,readConfigValue}=await import('../core/hermes-config.mjs');
 const out=godspeedHermesSettings('model:\n  default: x\nquick_commands: {}\n');
 assert.equal(readConfigValue(out,['quick_commands','radar','type']),'alias');assert.equal(readConfigValue(out,['quick_commands','radar','target']),'"/mc-radar"');
 assert.equal(readConfigValue(out,['quick_commands','subs','target']),'"/subscription-review"');
 assert.equal(godspeedHermesSettings(out),out,'written once');
 const mine=godspeedHermesSettings('quick_commands:\n  subs:\n    type: exec\n    command: my-subs\n');
 assert.equal(readConfigValue(mine,['quick_commands','subs','command']),'my-subs');assert.equal(readConfigValue(mine,['quick_commands','radar','target']),'"/mc-radar"');
});

test('Settings, Notifications switches the morning brief and the weekly review on and off, at the times chosen',async t=>{
 const {store,hermes,scheduler}=await withGoal(t);
 assert.deepEqual(scheduler.notifications(),{daily:{enabled:false,time:'07:00'},weekly:{enabled:false,time:'17:00',day:5},delivery:'local'});
 await scheduler.setNotifications({daily:{enabled:true,time:'06:45'},weekly:{enabled:true,day:5,time:'17:00'}});
 const brief=()=>hermes.jobs().find(j=>j.script===BRIEF_SCRIPT),review=()=>hermes.jobs().find(j=>j.skill==='weekly-review');
 assert.equal(brief().schedule.expr,'45 6 * * *');assert.equal(brief().name,'Morning brief');assert.equal(brief().workdir,store.root);
 assert.equal(brief().no_agent,true,'the notebook\'s own briefing, not the recipe (#160)');assert.equal(brief().skill,null);
 assert.equal(review().schedule.expr,'0 17 * * 5');
 assert.deepEqual(scheduler.notifications().daily,{enabled:true,time:'06:45'});
 await scheduler.setNotifications({daily:{enabled:true,time:'07:30'}});assert.equal(brief().schedule.expr,'30 7 * * *','moved, not doubled');assert.equal(hermes.jobs().filter(j=>j.script===BRIEF_SCRIPT).length,1);
 await scheduler.setNotifications({daily:{enabled:false,time:'07:30'}});assert.equal(brief().enabled,false,'off pauses it');
 await scheduler.setNotifications({daily:{enabled:true,time:'07:30'}});assert.equal(brief().enabled,true,'on resumes it');
 await assert.rejects(scheduler.setNotifications({weekly:{enabled:true,day:9,time:'17:00'}}),/day of the week/);
});

test('the morning brief reads what the watches found',()=>{
 const recipe=fs.readFileSync(fileURLToPath(new URL('../../starter-godspeed/skills/morning-brief/SKILL.md',import.meta.url)),'utf8');
 assert.match(recipe,/## What your watches found/);assert.match(recipe,/mc-watch pull --channel brief --limit 1 --dry-run/);assert.match(recipe,/watch\/\*\/findings\.md/);
});

// THE MORNING BRIEF IS THE NOTEBOOK'S OWN BRIEFING (#160): a script routine whose script runs
// core/briefing.mjs (scripts/morning-brief.mjs), never the starter recipe as an AI job.
test('a Morning brief added in Settings is the script that runs the notebook\'s own briefing',async t=>{
 const {store,hermes,scheduler,home}=await withGoal(t);
 const row=await scheduler.control({kind:'morning-brief',interval_ms:86400000},{enable:true});
 const job=hermes.jobs().find(j=>j.id===row.id);
 assert.equal(job.script,BRIEF_SCRIPT);assert.equal(job.no_agent,true);assert.equal(job.skill,null);assert.equal(job.name,'Morning brief');
 assert.equal(job.schedule_display,'1440m');assert.equal(job.workdir,store.root);
 const wrapper=fs.readFileSync(path.join(home,'scripts',BRIEF_SCRIPT),'utf8');assert.match(wrapper,/main\("brief"\)/);
 const config=JSON.parse(fs.readFileSync(path.join(home,'scripts','godspeed-routines.json'),'utf8'));
 assert.ok(fs.existsSync(config.brief),'the script it runs is there: '+config.brief);assert.match(config.brief,/morning-brief\.mjs$/);
 assert.equal(readNotebookRoutines(store).jobs.find(e=>e.id===row.id)?.key,'morning-brief');
 await assert.rejects(scheduler.control({kind:'morning-brief',at:'07:00'},{enable:true}),/already runs this/);
 assert.deepEqual(scheduler.notifications().daily.enabled,true,'Settings > Notifications finds it');
});

test('a Morning brief the notebook made as the recipe becomes the script, at its time and paused as it was',async t=>{
 const {store,hermes,scheduler}=await withGoal(t);
 const jobs=hermes.jobs();
 jobs.push({id:'old-brief',name:'Morning brief',schedule:{kind:'cron',expr:'15 6 * * *'},schedule_display:'15 6 * * *',prompt:'Follow the morning-brief recipe for this mission control.',script:null,skill:'morning-brief',no_agent:false,deliver:'telegram',workdir:store.root,enabled:false});
 jobs.push({id:'theirs',name:'My own brief',schedule:{kind:'cron',expr:'0 9 * * *'},schedule_display:'0 9 * * *',prompt:'Brief me',script:null,skill:'morning-brief',no_agent:false,deliver:'local',workdir:'/somewhere/else',enabled:true});
 hermes.write(jobs);rememberNotebookRoutine(store,{id:'old-brief',key:'morning-brief',name:'Morning brief',skill:'morning-brief'});
 const moved=await scheduler.followBrief();
 assert.equal(moved.length,1);
 const now=hermes.jobs(),made=now.find(j=>j.id===moved[0]);
 assert.equal(now.some(j=>j.id==='old-brief'),false,'the recipe job is gone');
 assert.equal(made.script,BRIEF_SCRIPT);assert.equal(made.schedule.expr,'15 6 * * *');assert.equal(made.enabled,false,'paused as it was');assert.equal(made.deliver,'telegram');
 assert.ok(now.some(j=>j.id==='theirs'),'a brief of the owner\'s own stays');
 assert.deepEqual(readNotebookRoutines(store).jobs.filter(e=>e.key==='morning-brief').map(e=>e.id),[made.id]);
 assert.deepEqual(await scheduler.followBrief(),[],'once');
});

test('Settings, Notifications moves a recipe brief over before it changes it',async t=>{
 const {store,hermes,scheduler}=await withGoal(t);
 const jobs=hermes.jobs();
 jobs.push({id:'old-brief',name:'Morning brief',schedule:{kind:'cron',expr:'15 6 * * *'},schedule_display:'15 6 * * *',prompt:'Follow the morning-brief recipe for this mission control.',script:null,skill:'morning-brief',no_agent:false,deliver:'local',workdir:store.root,enabled:true});
 hermes.write(jobs);
 await scheduler.setNotifications({daily:{enabled:true,time:'07:30'}});
 const briefs=hermes.jobs().filter(j=>j.name==='Morning brief');
 assert.equal(briefs.length,1);assert.equal(briefs[0].script,BRIEF_SCRIPT);assert.equal(briefs[0].schedule.expr,'30 7 * * *');
});

test('a move of the recipe brief that stopped half-way never leaves two briefs, nor a paused one running',async t=>{
 const {store,hermes,scheduler,home}=await withGoal(t);
 const recipe=over=>({id:'old-brief',name:'Morning brief',schedule:{kind:'cron',expr:'15 6 * * *'},schedule_display:'15 6 * * *',prompt:'Follow the morning-brief recipe for this mission control.',script:null,skill:'morning-brief',no_agent:false,deliver:'local',workdir:store.root,enabled:true,...over});
 // A script brief made by a move that stopped before the recipe job went: the recipe job only goes.
 hermes.write([...hermes.jobs(),recipe(),{id:'made-before',name:'Morning brief',schedule:{kind:'cron',expr:'15 6 * * *'},schedule_display:'15 6 * * *',prompt:null,script:BRIEF_SCRIPT,no_agent:true,deliver:'local',workdir:store.root,enabled:true}]);
 assert.deepEqual(await scheduler.followBrief(),[]);
 assert.deepEqual(hermes.jobs().filter(j=>j.name==='Morning brief').map(j=>j.id),['made-before']);
 // A paused recipe brief whose new script brief could not be paused: the new one is taken out again.
 hermes.write([...hermes.jobs().filter(j=>j.name!=='Morning brief'),recipe({enabled:false})]);
 const failing=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:async(exe,args,options)=>{if(args[1]==='pause')throw Error('Hermes could not pause it');return hermes.run(exe,args,options);}});
 await assert.rejects(failing.followBrief(),/could not pause/);
 const left=hermes.jobs().filter(j=>j.name==='Morning brief');
 assert.deepEqual(left.map(j=>[j.id,j.enabled]),[['old-brief',false]],'only the paused recipe brief is left, for the next tick');
});

test('a script brief already there takes the recipe brief\'s time, delivery and on or off before the recipe brief goes',async t=>{
 const {store,hermes,scheduler}=await withGoal(t);
 hermes.write([...hermes.jobs(),
  {id:'old-brief',name:'Morning brief',schedule:{kind:'cron',expr:'15 6 * * *'},schedule_display:'15 6 * * *',prompt:'Follow the morning-brief recipe for this mission control.',script:null,skill:'morning-brief',no_agent:false,deliver:'telegram',workdir:store.root,enabled:true},
  {id:'script-brief',name:'Morning brief',schedule:{kind:'cron',expr:'0 9 * * *'},schedule_display:'0 9 * * *',prompt:null,script:BRIEF_SCRIPT,no_agent:true,deliver:'local',workdir:store.root,enabled:false}]);
 await scheduler.followBrief();
 const left=hermes.jobs().filter(j=>j.name==='Morning brief');
 assert.deepEqual(left.map(j=>[j.id,j.schedule.expr,j.deliver,j.enabled]),[['script-brief','15 6 * * *','telegram',true]],'the briefing stays switched on, at its time, where it went');
});

test('two routines running at once say a queued notice once',{skip:!['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}})&&'needs Python'},async t=>{
 const {root,home,store,scheduler}=await withGoal(t);
 const journal=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
 execFileSync(process.execPath,[journal,'config','set','nudge.enabled','on','--godspeed',root],{env:{...process.env,GODSPEED_JOURNAL_GIT_SYNC:'off'},windowsHide:true});
 await scheduler.followJournal();
 const {queueNotice}=await import('../core/notices.mjs');queueNotice(store,{id:'backup-1',text:'Last night\'s backup failed.'});
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const script=path.join(home,'scripts','godspeed-journal-checkins.py');
 const start=()=>new Promise(resolve=>{const child=spawn(python,[script],{cwd:path.join(home,'scripts'),env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true});let out='';child.stdout.on('data',d=>out+=d);child.on('close',code=>resolve({code,out:out.trim()}));});
 const ticks=await Promise.all([start(),start()]);
 assert.deepEqual(ticks.map(r=>r.code),[0,0]);assert.deepEqual(ticks.map(r=>r.out).sort(),['','Last night\'s backup failed.'],'said by one of them');
 assert.equal(store.list('conversation_messages').filter(m=>m.source_app==='background').length,1,'and recorded once');
 assert.deepEqual(fs.readdirSync(home).filter(f=>f.endsWith('.claim')),[],'no claim left behind');
});

test('two routines running at once say two queued notices once each, and a third tick has nothing left',{skip:!['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}})&&'needs Python'},async t=>{
 const {root,home,store,scheduler}=await withGoal(t);
 const journal=fileURLToPath(new URL('../../third-party/addons/godspeed-journal/bin/godspeed-journal.mjs',import.meta.url));
 execFileSync(process.execPath,[journal,'config','set','nudge.enabled','on','--godspeed',root],{env:{...process.env,GODSPEED_JOURNAL_GIT_SYNC:'off'},windowsHide:true});
 await scheduler.followJournal();
 const {queueNotice}=await import('../core/notices.mjs');queueNotice(store,{id:'backup-1',text:'Last night\'s backup failed.'});queueNotice(store,{id:'disk-1',text:'The disk is nearly full.'});
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const script=path.join(home,'scripts','godspeed-journal-checkins.py');
 const start=()=>new Promise(resolve=>{const child=spawn(python,[script],{cwd:path.join(home,'scripts'),env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true});let out='';child.stdout.on('data',d=>out+=d);child.on('close',code=>resolve({code,out:out.trim()}));});
 const ticks=await Promise.all([start(),start()]);
 assert.deepEqual(ticks.map(r=>r.code),[0,0]);assert.deepEqual(ticks.map(r=>r.out).sort(),['Last night\'s backup failed.','The disk is nearly full.'],'one each');
 assert.equal((await start()).out,'','both are remembered');
 assert.equal(store.list('conversation_messages').filter(m=>m.source_app==='background').length,2,'and recorded once each');
 assert.deepEqual(fs.readdirSync(home).filter(f=>f.endsWith('.claim')),[],'no claim left behind');
});

// AN ADOPTED MISSION CONTROL (4 November 2026, #225): the one Godspeed did not make from the starter gets
// the notice sender, and each of its routines is a switch that is off until switched on in Settings.
const havePython=['python','python3'].some(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
async function adoptedFixture(t,{device='pc'}={}){
 const root=temporary(t),home=path.join(root,'.hermes-home');
 fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# My own mission control\n');fs.writeFileSync(path.join(root,'rules','my-own-rule.md'),'Mine.\n');
 installStarter(root);fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: x\n');
 const store=new Store(root,{device}),hermes=fakeHermes(home),scheduler=new NativeScheduler(store,{home,executable:'hermes',device,run:hermes.run});
 await store.saveAsync('settings',{id:'installation',owner:device,timezone:'Europe/Berlin',delivery:'notebook'});
 const tick=async()=>{scheduler.lastTick=0;await scheduler.tick();};
 const job=name=>hermes.jobs().find(j=>j.name===name);
 const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
 const runScript=name=>execFileSync(python,[path.join(home,'scripts',name)],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true}).trim();
 return {root,home,store,hermes,scheduler,tick,job,runScript};
}

test('an adopted mission control gets the notice sender, keeps the notices queued before it, and says only later ones',{skip:!havePython&&'needs Python'},async t=>{
 const {root,home,store,hermes,tick,job,runScript}=await adoptedFixture(t),{queueNotice,readNotices}=await import('../core/notices.mjs');
 queueNotice(store,{id:'before-1',text:'An old notice.'});
 await tick();
 assert.deepEqual(hermes.calls.filter(c=>c[1]==='create').map(c=>c[c.indexOf('--name')+1]),['Godspeed notices'],'one job, the sender');
 const sender=job('Godspeed notices');assert.equal(sender.schedule.expr,'*/15 * * * *');assert.equal(sender.no_agent,true);assert.equal(sender.script,'godspeed-notices.py');assert.equal(sender.workdir,root);assert.equal(sender.enabled,true);
 assert.ok(!store.get('settings','starting-routines'));assert.equal(fs.existsSync(path.join(root,'coach','weekly-check-in')),false);
 const old=readNotices(store).find(n=>n.id==='before-1');assert.match(old.not_sent.reason,/before Godspeed began sending/);
 await tick();assert.equal(hermes.calls.filter(c=>c[1]==='create').length,1,'made once');
 queueNotice(store,{id:'between-1',text:'Queued after the job was made, before it first ran.'});
 assert.equal(runScript('godspeed-notices.py'),'','the first run says nothing that was queued before it');
 assert.match(readNotices(store).find(n=>n.id==='between-1').not_sent.reason,/before Godspeed began sending/);
 queueNotice(store,{id:'after-1',text:'A new notice.'});
 assert.equal(runScript('godspeed-notices.py'),'A new notice.');
 assert.equal(runScript('godspeed-notices.py'),'','the old ones are never said');
 assert.equal(readNotices(store).length,3,'and are kept');
 // A producer that read the queue before the first start and wrote it back after brings the old notice back unmarked.
 const file=path.join(store.state,'notices.json'),queued=JSON.parse(fs.readFileSync(file,'utf8'));
 queued.notices=queued.notices.map(({not_sent,...n})=>n.id==='before-1'?{...n,at:new Date(Date.now()+60000).toISOString()}:n).filter(n=>n.id==='before-1'||n.id==='after-1');
 fs.writeFileSync(file,JSON.stringify(queued));queueNotice(store,{id:'later-1',text:'A later notice.'});
 assert.equal(runScript('godspeed-notices.py'),'A later notice.','the old one is not sent though nothing marks it and its stamp is no older than the start');
});

test('a notice sender its owner removed from Hermes is not made again',{skip:!havePython&&'needs Python'},async t=>{
 const {hermes,tick,job}=await adoptedFixture(t),made=()=>hermes.calls.filter(c=>c[1]==='create').length;
 await tick();assert.equal(made(),1);
 hermes.write(hermes.jobs().filter(j=>j.name!=='Godspeed notices'));
 await tick();await tick();
 assert.equal(job('Godspeed notices'),undefined,'it stays removed');assert.equal(made(),1,'and no create is attempted');
});

test('a notice queued before the first start stays held after more than 200 later deliveries, and a restored unmarked copy is not sent',{skip:!havePython&&'needs Python'},async t=>{
 const {store,home,tick,runScript}=await adoptedFixture(t),{queueNotice,readNotices}=await import('../core/notices.mjs');
 queueNotice(store,{id:'before-1',text:'An old notice.'});await tick();
 const file=path.join(store.state,'notices.json'),old=JSON.parse(fs.readFileSync(file,'utf8')).notices.map(({not_sent,...n})=>n);
 assert.equal(runScript('godspeed-notices.py'),'');
 fs.writeFileSync(path.join(home,'godspeed-notices-said.json'),JSON.stringify({ids:Array.from({length:250},(_,i)=>'later-'+i)}));
 const queued=JSON.parse(fs.readFileSync(file,'utf8'));queued.notices=old;fs.writeFileSync(file,JSON.stringify(queued));
 assert.equal(runScript('godspeed-notices.py'),'','the held id is in its own set, which the bounded history never trims');
 assert.equal(readNotices(store).length,1);
});

test('a reader that runs while the first-start hold is in progress says no old notice',{skip:!havePython&&'needs Python'},async t=>{
 const {store,home,tick,runScript}=await adoptedFixture(t),{queueNotice}=await import('../core/notices.mjs'),{setRoutineSwitch}=await import('../core/routine-switches.mjs');
 queueNotice(store,{id:'before-1',text:'An old notice.'});await tick();
 await setRoutineSwitch(store,{key:'coach-tick',on:true});await tick();
 // Many readers start together on the first start: the hold is under one lock, so each one sees it finished.
 const run=name=>new Promise(resolve=>{const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});execFile(python,[path.join(home,'scripts',name)],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},windowsHide:true},(e,out)=>resolve(out.trim()));});
 const outs=await Promise.all(['godspeed-notices.py','godspeed-coach-reminders.py','godspeed-notices.py','godspeed-coach-reminders.py'].map(run));
 assert.deepEqual(outs,['','','','']);
 assert.equal(runScript('godspeed-notices.py'),'');
});

test('Settings lists the routines of an adopted mission control, all off, and a starter-born one has no switches',async t=>{
 const {store,hermes,home}=await adoptedFixture(t),{routineSwitches,setRoutineSwitch,ADOPTED_NOTE,PROVIDER_NOTE}=await import('../core/routine-switches.mjs');
 const listed=routineSwitches(store,{jobs:hermes.jobs()});
 assert.equal(listed.note,ADOPTED_NOTE);assert.equal(listed.routines.length,10);
 assert.ok(listed.routines.every(r=>r.on===false&&r.state==='off'&&r.what));
 await setRoutineSwitch(store,{key:'connection-check',on:true});
 assert.equal(routineSwitches(store,{jobs:[]}).routines.find(r=>r.key==='connection-check').state,'waiting');
 await assert.rejects(setRoutineSwitch(store,{key:'nope',on:true}),/Choose one of the routines/);
 await assert.rejects(setRoutineSwitch(store,{key:'research',on:'yes'}),/switch it on or off/);
 assert.equal(routineSwitches(store,{jobs:[],home}).providerNote,null,'no provider set: the wrapper is active, no note');
 fs.appendFileSync(path.join(home,'config.yaml'),'cron:\n  provider: owners_own\n');
 assert.equal(routineSwitches(store,{jobs:[],home}).providerNote,PROVIDER_NOTE,'the owner\'s provider stays and the note says what is not delivered');
 const born=await withGoal(t);
 assert.equal(routineSwitches(born.store,{jobs:born.hermes.jobs()}),null);
 await assert.rejects(setRoutineSwitch(born.store,{key:'research',on:true}),/did not make from its starter/);
});

test('a routine switched on in an adopted mission control is made as on a starter-born one, paused when switched off, and no update switches it off',async t=>{
 noMail(t);
 const {root,home,store,hermes,scheduler,tick,job}=await adoptedFixture(t),{setRoutineSwitch,switchedOn}=await import('../core/routine-switches.mjs');
 await tick();assert.equal(hermes.jobs().length,1,'before any switch only the sender');
 // The daily connection check, with a messenger connected.
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 await tick();assert.equal(job(CONNECTION_JOB),undefined,'off: not made');
 await setRoutineSwitch(store,{key:'connection-check',on:true});await tick();
 const check=job(CONNECTION_JOB);assert.equal(check.schedule.expr,'0 5 * * *');assert.equal(check.script,'godspeed-connection-check.py');assert.equal(check.enabled,true);assert.equal(check.workdir,root);
 // An update puts the starter files again; the switch and the job stay.
 installStarter(root);
 const later=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:hermes.run});later.lastTick=0;await later.tick();
 assert.equal(switchedOn(store,'connection-check'),true);assert.equal(job(CONNECTION_JOB).enabled,true);
 await setRoutineSwitch(store,{key:'connection-check',on:false});await tick();assert.equal(job(CONNECTION_JOB).enabled,false,'off pauses it');
 await setRoutineSwitch(store,{key:'connection-check',on:true});await tick();assert.equal(job(CONNECTION_JOB).enabled,true,'on again resumes it');
 // A starting routine: the coach's reminders, made with the weekly check-in's clock.
 await setRoutineSwitch(store,{key:'coach-tick',on:true});await tick();
 const reminders=job('Coach reminders and habit check');assert.ok(reminders,'made');assert.equal(reminders.script,'godspeed-coach-reminders.py');assert.equal(reminders.deliver,'telegram');assert.equal(reminders.enabled,true);
 assert.ok(fs.existsSync(path.join(root,'coach','weekly-check-in')));
 await setRoutineSwitch(store,{key:'coach-tick',on:false});await tick();assert.equal(job('Coach reminders and habit check').enabled,false);
 await setRoutineSwitch(store,{key:'coach-tick',on:true});await tick();assert.equal(job('Coach reminders and habit check').enabled,true);
 // A routine the person removed in Hermes stays removed while its switch stays on.
 hermes.write(hermes.jobs().filter(j=>j.name!=='Coach reminders and habit check'));await tick();assert.equal(job('Coach reminders and habit check'),undefined);
 assert.equal(hermes.jobs().filter(j=>j.name==='Godspeed notices').length,1);
 void scheduler;
});

test('a switched-on coach routine never says a notice queued before the sender started',{skip:!havePython&&'needs Python'},async t=>{
 const {store,tick,runScript,home}=await adoptedFixture(t),{setRoutineSwitch}=await import('../core/routine-switches.mjs'),{queueNotice}=await import('../core/notices.mjs');
 queueNotice(store,{id:'before-1',text:'An old notice.'});
 await setRoutineSwitch(store,{key:'coach-tick',on:true});
 await tick();
 assert.ok(fs.existsSync(path.join(home,'scripts','godspeed-coach-reminders.py')));
 assert.equal(runScript('godspeed-coach-reminders.py'),'','the first reader holds what was queued before it, and says none of it');
 queueNotice(store,{id:'after-1',text:'A new notice.'});
 const said=[runScript('godspeed-coach-reminders.py'),runScript('godspeed-notices.py')].filter(Boolean);
 assert.deepEqual(said,['A new notice.'],'the new one once, the old one never');
});

test('a switch that the assistant cannot set up yet is saved and the answer says so',async t=>{
 const root=temporary(t);fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# My own mission control\n');installStarter(root);
 const was=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';
 const {createService}=await import('../server/main.mjs');
 const assistant=path.join(root,'assistant.json');fs.writeFileSync(assistant,JSON.stringify({verified:true,executable:'hermes',home:path.join(root,'.hermes-home')}));
 const was2=process.env.GODSPEED_ASSISTANT_CONFIG;process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 t.after(()=>{if(was2===undefined)delete process.env.GODSPEED_ASSISTANT_CONFIG;else process.env.GODSPEED_ASSISTANT_CONFIG=was2;});
 const service=await createService({root,device:'pc',port:0});
 t.after(async()=>{await service.close();if(was===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=was;});
 service.store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 service.scheduler.followNoticeSender=async()=>{throw Error('Hermes refused the job');};
 const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/routines/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'connection-check',on:true})});
 assert.notEqual(response.status,200);
 const {error}=await response.json();assert.match(error,/Your switch is saved/);assert.match(error,/Hermes refused the job/);
 const {switchedOn}=await import('../core/routine-switches.mjs');assert.equal(switchedOn(service.store,'connection-check'),true);
});

test('switching Mail counts on in an adopted mission control follows it at once',async t=>{
 const root=temporary(t);fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# My own mission control\n');installStarter(root);
 const was=process.env.GODSPEED_ORIGINAL_RUNTIME;process.env.GODSPEED_ORIGINAL_RUNTIME='on';
 const {createService}=await import('../server/main.mjs');
 const assistant=path.join(root,'assistant.json');fs.writeFileSync(assistant,JSON.stringify({verified:true,executable:'hermes',home:path.join(root,'.hermes-home')}));
 const was2=process.env.GODSPEED_ASSISTANT_CONFIG;process.env.GODSPEED_ASSISTANT_CONFIG=assistant;
 t.after(()=>{if(was2===undefined)delete process.env.GODSPEED_ASSISTANT_CONFIG;else process.env.GODSPEED_ASSISTANT_CONFIG=was2;});
 const service=await createService({root,device:'pc',port:0});
 t.after(async()=>{await service.close();if(was===undefined)delete process.env.GODSPEED_ORIGINAL_RUNTIME;else process.env.GODSPEED_ORIGINAL_RUNTIME=was;});
 service.store.save('settings',{id:'installation',owner:'pc',timezone:'Europe/Berlin',delivery:'notebook'});
 const hermes=fakeHermes(path.join(root,'.hermes-home'));service.scheduler.run=hermes.run;
 service.store.save('collections',{name:'Orders',field_schema:[],tracker:{names:['Orders'],cadence:'any',talks:[],specialist:null,mail:{senders:['shop.example.invalid'],subjects:['order'],mailbox:'gmail'}}});
 const response=await fetch('http://127.0.0.1:'+service.address.port+'/api/routines/switch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:'mail-count',on:true})});
 assert.equal(response.status,200);
 const made=hermes.jobs().find(j=>j.name==='Mail counts');
 assert.ok(made,'the job exists as soon as the answer does');assert.notEqual(made.enabled,false);assert.equal(made.deliver,'local');
});

test('the first enabled connection check says the failure notice it queued itself, and a routine that fails to be made does not stop the next one',{skip:!havePython&&'needs Python'},async t=>{
 noMail(t);
 const {root,home,store,hermes,tick,job,runScript}=await adoptedFixture(t),{setRoutineSwitch}=await import('../core/routine-switches.mjs'),{queueNotice}=await import('../core/notices.mjs');
 await tick();
 fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 await setRoutineSwitch(store,{key:'connection-check',on:true});await tick();
 queueNotice(store,{id:'old-1',text:'An old notice.'});
 const stand=path.join(root,'stand-in-check.mjs');
 fs.writeFileSync(stand,"import {Store} from '"+new URL('../core/records/store.mjs',import.meta.url).href+"';import {queueNotice} from '"+new URL('../core/notices.mjs',import.meta.url).href+"';queueNotice(new Store(process.env.GODSPEED_WORKSPACE,{device:'pc'}),{id:'"+CONNECTION_NOTICE_PREFIX+"telegram-2026-11-05',text:'Telegram refused your bot key.'});");
 const file=path.join(home,'scripts','godspeed-routines.json');fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),connection_check:stand}));
 assert.equal(runScript('godspeed-connection-check.py'),'Telegram refused your bot key.','the first run says its own notice and not the old one');
 // Two routines switched on, the earlier one refused by Hermes: the later one is still made.
 const refusing=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run:(...a)=>{const args=a.find(Array.isArray)||[];if(args.includes('create')&&args.includes('godspeed-daily-round-choose.py'))return Promise.reject(Error('refused'));return hermes.run(...a);}});
 await setRoutineSwitch(store,{key:'decide',on:true});await setRoutineSwitch(store,{key:'due',on:true});
 const quiet=console.error;console.error=()=>{};
 try{await assert.rejects(refusing.followSwitches(),/refused/);}finally{console.error=quiet;}
 assert.ok(job('Deadline reminders'),'the later routine was made');
});

// Two languages share these: the wrapper files the notebook writes name a routine that the Python
// runner must dispatch, and both write the same reason into the queue the sender reads.
test('every routine wrapper names a routine the Python runner dispatches, and both languages write the same not-sent reason',async t=>{
 const {routineFiles}=await import('../core/starting-routines.mjs'),{NOT_SENT_BEFORE_SENDER}=await import('../core/notices.mjs');
 const runner=fs.readFileSync(fileURLToPath(new URL('../core/routine-scripts/godspeed_routines.py',import.meta.url)),'utf8');
 const table=runner.match(/^ROUTINES = \{([\s\S]*?)\}$/m)[1],dispatched=[...table.matchAll(/"([a-z-]+)":/g)].map(m=>m[1]).sort();
 const root=temporary(t),files=routineFiles({root,home:path.join(root,'.hermes-home'),state:path.join(root,'.godspeed')});
 const emitted=Object.entries(files).filter(([name])=>name!=='godspeed_routines.py'&&name.endsWith('.py')).map(([,text])=>text.match(/^main\("([a-z-]+)"\)$/m)[1]).sort();
 assert.deepEqual([...new Set(emitted)],dispatched);
 assert.equal(runner.match(/^NOT_SENT_BEFORE_SENDER = "(.*)"$/m)[1],NOT_SENT_BEFORE_SENDER);
});

test('both languages write the same not_sent object: exactly a reason and an ISO time',{skip:!havePython&&'needs Python'},async t=>{
 const {store,tick,runScript}=await adoptedFixture(t),{queueNotice,readNotices,holdQueuedNotices}=await import('../core/notices.mjs');
 const shape=n=>{assert.deepEqual(Object.keys(n.not_sent).sort(),['at','reason']);assert.equal(typeof n.not_sent.reason,'string');assert.match(n.not_sent.at,/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);};
 await tick();
 queueNotice(store,{id:'node-1',text:'One.'});holdQueuedNotices(store);
 const fromNode=readNotices(store)[0];shape(fromNode);
 queueNotice(store,{id:'python-1',text:'Two.'});runScript('godspeed-notices.py');
 const py=readNotices(store).find(n=>n.id==='python-1');shape(py);
 assert.equal(py.not_sent.reason,fromNode.not_sent.reason);
});
