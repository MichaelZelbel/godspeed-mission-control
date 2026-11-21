import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync,execFileSync} from 'node:child_process';
import {NativeScheduler} from '../core/native-scheduler.mjs';import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';
import {installStarter} from '../core/starter-workspace.mjs';import {runCommand} from '../core/child-process.mjs';import {enableKinds} from '../core/notebook-routines.mjs';
import {readPrep,prepProblem} from '../../third-party/addons/godspeed-coach/lib/prep.mjs';import {readArea} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';

// THE COACHING TALK PREPARATION ON AN INSTALLED MISSION CONTROL, AT THE BOUNDARY A PERSON USES (#670,
// 18 November 2026). Until then a clean install had no coach-prep recipe, so the routine "Coaching
// talk preparation" was neither installed by the first goal nor offered by the routine selector, and
// the writer's prompt let an unknown fact turn a usable preparation into a draft. These tests install
// the starter the way a first goal does, pick "Coaching talk preparation" from the routines Settings
// lists and press Run now (NativeScheduler startRun). The Hermes stand-in only does what Hermes does
// with a script job: it runs the installed wrapper from its scripts folder. Everything after that is
// the product: godspeed_routines.py, tools/mc-coach-prep with its unchanged prep-check gate, and, at
// the talk's own time, the coach's gate, whose brief the talk job follows (`talk open --from-prep`).
// The one thing stood in for is the model that writes the preparation (`hermes chat`), which follows
// the shipped coach-prep recipe in the small way below: it grounds the opening and the talk card in
// the goal the area serves, and writes a draft naming the missing fact when the area serves none.
const python=process.env.GODSPEED_TEST_PYTHON||(process.platform==='win32'?'python':'python3');
const usable=process.platform!=='win32'&&spawnSync(python,['--version']).status===0&&spawnSync('bash',['--version']).status===0;
// A Berlin wall-clock time as the UTC instant the coach's clock (GODSPEED_NOW) takes.
const berlin=(day,time)=>{const zone=new Date(day+'T12:00:00Z').toLocaleString('en-US',{timeZone:'Europe/Berlin',timeZoneName:'longOffset'}).split('GMT')[1]||'+00:00';return new Date(day+'T'+time+':00'+zone).toISOString();};
const coach=fileURLToPath(new URL('../../third-party/addons/godspeed-coach/bin/godspeed-coach.mjs',import.meta.url));

// The writer. mc-run hands it the prompt on stdin (`hermes chat --query-file -`).
const WRITER=`#!/usr/bin/env node
const fs=require('fs'),path=require('path');
const args=process.argv.slice(2);if(!args.includes('chat')){process.exit(0);}
const prompt=fs.readFileSync(0,'utf8');
const file=(prompt.match(/and write (coach\\/[a-z0-9-]+\\/prep\\/\\d{4}-\\d{2}-\\d{2}\\.md)\\./)||[])[1];
const now=(prompt.match(/Now: (\\S+) \\(UTC\\)/)||[])[1];
if(!file||!now){console.log('No talk was named.');process.exit(1);}
const root=process.env.GODSPEED_ROOT,[,area,,day]=file.replace(/\\.md$/,'').split('/');
const head=fs.readFileSync(path.join(root,'coach',area,'area.md'),'utf8');
const serves=((head.match(/^SERVES:[ \\t]*(.*)$/m)||[])[1]||'').trim();
const goalFile=serves&&path.join(root,'goals',serves+'.md');
const goal=goalFile&&fs.existsSync(goalFile)?(fs.readFileSync(goalFile,'utf8').match(/^TITLE:[ \\t]*(.*)$/m)||[])[1]:null;
const research=goal&&path.join(root,'goals','research',serves,'brief.md');
const talk=(prompt.match(/on \\d{4}-\\d{2}-\\d{2} at (\\d{2}:\\d{2})/)||[])[1]||'18:00';
const body=goal
 ?'STATE: ready\\n\\n## The opening\\nYour goal is to '+goal.toLowerCase()+'. This week, what is one run you can put in the calendar for it?\\n\\n## Talk card\\nGoal: '+goal+' ('+serves+'). Research brief: '+path.relative(root,research).split(path.sep).join('/')+'. One move to agree: one dated run this week.\\n\\n## Where they stand\\n- The goal was adopted; no run is logged yet.\\n\\n## Gaps\\nNo training log yet.\\n'
 :'STATE: draft\\n\\n## The opening\\n\\n## Talk card\\n\\n## Gaps\\nThis area serves no adopted goal, so there is nothing to ground the opening or the talk card in.\\n';
fs.mkdirSync(path.join(root,path.dirname(file)),{recursive:true});
fs.writeFileSync(path.join(root,file),'AREA: '+area+'\\nTALK: '+day+' '+talk+'\\nPREPARED: '+now+'\\n'+body);
console.log(goal?'Prepared the talk of '+day+'.':'The talk of '+day+' stays a draft: its area serves no adopted goal.');
`;

async function installed(t){
 for(const name of ['GODSPEED_REVISION','GODSPEED_WEB_ADDRESS']){const was=process.env[name];delete process.env[name];t.after(()=>{if(was===undefined)delete process.env[name];else process.env[name]=was;});}
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-coach-prep-installed-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'.hermes-home'),bin=path.join(root,'.writer');installStarter(root);
 fs.mkdirSync(home,{recursive:true});fs.writeFileSync(path.join(home,'config.yaml'),'model:\n  default: x\n');
 fs.mkdirSync(bin,{recursive:true});fs.writeFileSync(path.join(bin,'hermes'),WRITER,{mode:0o755});
 const file=path.join(home,'cron','jobs.json'),jobs=()=>fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).jobs:[],ran=[];let serial=0;
 const run=async(exe,args,options={})=>{
  if(exe!=='hermes')return runCommand(exe,args,options);
  const [,verb,...rest]=args,flag=name=>{const i=rest.indexOf(name);return i===-1?null:rest[i+1];},list=jobs();
  if(verb==='create'){list.push({id:'job'+(++serial),name:flag('--name'),schedule:{kind:'cron',expr:rest[0]},script:flag('--script'),skill:flag('--skill'),no_agent:rest.includes('--no-agent'),deliver:flag('--deliver'),workdir:flag('--workdir'),enabled:true,state:'scheduled'});fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({jobs:list}));}
  // `hermes cron run <id>`: what Hermes does with a script job, run its installed script.
  if(verb==='run'){
   const job=list.find(j=>j.id===rest[0]);ran.push(job.name);
   const r=spawnSync(python,[path.join(home,'scripts',job.script)],{cwd:path.join(home,'scripts'),encoding:'utf8',timeout:600000,env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,PYTHONIOENCODING:'utf-8',GODSPEED_COACH_GIT_SYNC:'off'}});
   return {stdout:r.stdout,stderr:r.stderr,code:r.status};
  }
  return {stdout:''};
 };
 const store=new Store(root,{device:'pc'}),scheduler=new NativeScheduler(store,{home,executable:'hermes',device:'pc',run});
 await scheduler.configure({goal:'Run a fictional 10k',timezone:'Europe/Berlin'});
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date());
 const tomorrow=new Date(Date.parse(day+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 const coachCli=(...a)=>execFileSync(process.execPath,[coach,...a,'--godspeed',root],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GODSPEED_COACH_GIT_SYNC:'off'}});
 // The weekly check-in the first goal made talks every day from tomorrow, so tonight's run has a talk to prepare.
 coachCli('area','set','weekly-check-in','RHYTHM','daily');
 // Run now as Settings > Routines does it: the row the person sees, then its button.
 const runNow=async()=>{
  const query=new QueryService(store);query.nativeHermesHome=home;
  const row=query.rows('jobs').find(j=>j.title==='Coaching talk preparation');
  assert.ok(row,'Settings > Routines lists Coaching talk preparation');
  assert.deepEqual(scheduler.startRun(row.id),{started:true,id:row.id});
  await scheduler.running;
  const status=JSON.parse(fs.readFileSync(path.join(home,'godspeed-routines-status.json'),'utf8'))['coach-prep'];
  return {status,summary:fs.readFileSync(path.join(root,'routines','coach-prep',day,'summary.txt'),'utf8')};
 };
 const talk=area=>path.join(root,'coach',area,'talks',tomorrow+'.md');
 // The talk's own time: the installed talk job runs the coach's gate, and its model runs the open
 // command the brief names, exactly as written there (the coach recipe, "Opening a talk").
 const app=path.join(root,'.coach-app'),at=time=>berlin(tomorrow,time);
 const gateAt=time=>execFileSync(process.execPath,[coach,'gate','--godspeed',root],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GODSPEED_COACH_GIT_SYNC:'off',GODSPEED_COACH_APP:app,GODSPEED_NOW:at(time)}});
 const openAsBriefed=(brief,time)=>{
  const line=brief.match(/godspeed-coach talk open ([a-z0-9-]+) --godspeed "([^"]+)" --from-prep "([^"]+)"/);
  assert.ok(line,'the brief opens the talk from its preparation');
  return execFileSync(process.execPath,[coach,'talk','open',line[1],'--godspeed',line[2],'--from-prep',line[3]],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env:{...process.env,GODSPEED_COACH_GIT_SYNC:'off',GODSPEED_NOW:at(time),GODSPEED_SCHEDULED_RUN:'1'}});
 };
 return {root,home,store,scheduler,ran,tomorrow,coachCli,runNow,talk,gateAt,openAsBriefed};
}

test('Run now on the installed Coaching talk preparation makes a ready preparation, and the talk opens from it',{skip:!usable&&'needs Python and bash on Linux or macOS'},async t=>{
 const {root,ran,tomorrow,runNow,talk,coachCli,gateAt,openAsBriefed}=await installed(t);
 assert.ok(enableKinds(root).some(k=>k.kind==='coach-prep'),'the routine selector offers Coaching talk preparation on a clean install');
 const {status,summary}=await runNow();
 assert.deepEqual(ran,['Coaching talk preparation'],'Run now ran the installed routine');
 assert.equal(status.failed,null,summary);
 const prepRel=`coach/weekly-check-in/prep/${tomorrow}.md`,prep=readPrep(path.join(root,prepRel));
 assert.equal(prep.state,'ready');
 assert.equal(prepProblem(prep,readArea(path.join(root,'coach','weekly-check-in'))),null,'the coach accepts the preparation');
 assert.match(prep.opening,/run a fictional 10k/,'the opening is grounded in the adopted goal');
 assert.match(prep.card,/goals\/research\/run-a-fictional-10k\/brief\.md/,'the talk card names the goal\'s research');
 assert.match(coachCli('prep-check','weekly-check-in','--date',tomorrow),/^ready: /);
 assert.match(summary,new RegExp(`weekly-check-in ${tomorrow}: prepared \\(${prepRel}\\)`));
 assert.ok(!fs.existsSync(talk('weekly-check-in')),'the preparation waits for its talk: nothing is opened or sent ahead');
 // Tomorrow at 18:00 the talk job's gate wakes for it, and its brief opens it from the preparation.
 assert.equal(gateAt('17:59').trim(),'{"wakeAgent": false}');
 const said=openAsBriefed(gateAt('18:01'),'18:01');
 const opened=fs.readFileSync(talk('weekly-check-in'),'utf8');
 assert.match(opened,new RegExp(`PREP: ${prepRel}`),'the talk opened from the preparation');
 assert.ok(opened.includes(prep.opening)&&said.includes(prep.opening),'with its prepared opening, which is what the person is sent');
 assert.ok(opened.includes(prep.card.split('\n')[0]),'and its talk card');
});

test('Run now keeps an insufficient preparation a draft that says why, and the talk that qualified still opens from its own',{skip:!usable&&'needs Python and bash on Linux or macOS'},async t=>{
 const {root,tomorrow,runNow,talk,coachCli,gateAt,openAsBriefed}=await installed(t);
 // An area that serves no adopted goal: there is nothing to ground its talk in.
 coachCli('area','add','health','--title','Health','--rhythm','daily','--time','19:00');
 const {status,summary}=await runNow();
 const draft=readPrep(path.join(root,'coach','health','prep',tomorrow+'.md'));
 assert.equal(draft.state,'draft','the insufficient preparation stays a draft');
 assert.match(draft.text,/## Gaps\nThis area serves no adopted goal/,'and the draft says why');
 assert.match(summary,new RegExp(`health ${tomorrow}: NOT PREPARED \\(.*draft`),'the run\'s summary names it and why');
 assert.match(status.failed,/could not be prepared ahead/,'Settings > Routines shows the run as failed');
 assert.equal(readPrep(path.join(root,'coach','weekly-check-in','prep',tomorrow+'.md')).state,'ready','the other talk of the same run was prepared');
 assert.throws(()=>coachCli('talk','open','health','--date',tomorrow,'--from-prep',`coach/health/prep/${tomorrow}.md`),/STATE is draft/,'the coach refuses to open a talk from the draft');
 // The qualifying talk opens from its preparation at 18:00; the health talk at 19:00 opens from its brief.
 openAsBriefed(gateAt('18:01'),'18:01');
 assert.match(fs.readFileSync(talk('weekly-check-in'),'utf8'),new RegExp(`PREP: coach/weekly-check-in/prep/${tomorrow}\\.md`),'the qualifying preparation opened its talk');
 const health=gateAt('19:01');
 const record=(health.match(/^Record: coach\/health\/talks\/.*$/m)||[''])[0];
 assert.ok(record,'the health talk is due');
 assert.doesNotMatch(record,/--from-prep/,'it is never opened from the draft');
 assert.match(health,/^## Not prepared\nThe preparation for this talk is not ready/m,'and its opening says the preparation is not ready');
 assert.ok(!fs.existsSync(talk('health')));
});
