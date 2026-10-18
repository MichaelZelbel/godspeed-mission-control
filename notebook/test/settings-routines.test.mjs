import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {NativeScheduler,nativeJobs} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';
import {installStarter} from '../core/starter-workspace.mjs';import {readMachineRecord} from '../core/starting-routines.mjs';import {runCommand} from '../core/child-process.mjs';
import {cronCalendar,calendarCron,retimeWhat} from '../core/routine-times.mjs';import {enableKinds,readNotebookRoutines,JOURNAL_JOB,deliveryFor} from '../core/notebook-routines.mjs';
import {personalOperation} from '../core/personal-operations.mjs';import {readArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';

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
 const brief=()=>hermes.jobs().find(j=>j.skill==='morning-brief'),review=()=>hermes.jobs().find(j=>j.skill==='weekly-review');
 assert.equal(brief().schedule.expr,'45 6 * * *');assert.equal(brief().name,'Morning brief');assert.equal(brief().workdir,store.root);
 assert.equal(review().schedule.expr,'0 17 * * 5');
 assert.deepEqual(scheduler.notifications().daily,{enabled:true,time:'06:45'});
 await scheduler.setNotifications({daily:{enabled:true,time:'07:30'}});assert.equal(brief().schedule.expr,'30 7 * * *','moved, not doubled');assert.equal(hermes.jobs().filter(j=>j.skill==='morning-brief').length,1);
 await scheduler.setNotifications({daily:{enabled:false,time:'07:30'}});assert.equal(brief().enabled,false,'off pauses it');
 await scheduler.setNotifications({daily:{enabled:true,time:'07:30'}});assert.equal(brief().enabled,true,'on resumes it');
 await assert.rejects(scheduler.setNotifications({weekly:{enabled:true,day:9,time:'17:00'}}),/day of the week/);
});

test('the morning brief reads what the watches found',()=>{
 const recipe=fs.readFileSync(fileURLToPath(new URL('../../starter-godspeed/skills/morning-brief/SKILL.md',import.meta.url)),'utf8');
 assert.match(recipe,/## What your watches found/);assert.match(recipe,/mc-watch pull --channel brief --limit 1 --dry-run/);assert.match(recipe,/watch\/\*\/findings\.md/);
});
