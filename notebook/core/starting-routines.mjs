import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,atomic} from './records/store.mjs';
import {addArea,findArea,listAreas,rhythmWords,nextTalkDay} from '../../third-party/addons/godspeed-coach/lib/areas.mjs';
import {loadSettings as coachSettings,saveSettings as saveCoach} from '../../third-party/addons/godspeed-coach/lib/settings.mjs';
import {localParts,addDays,zonedToUtc} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {TALK_PROMPT,NOTEBOOK_TALK_JOB,NOTEBOOK_TICK_JOB,TALK_JOB,TICK_JOB} from '../../third-party/addons/godspeed-coach/lib/setup.mjs';

// The routines a reader's first goal starts (Teach It Once, Chapters 3, 5, 8, 24, 25 and 30): the
// daily round, deadline reminders and a weekly check-in. Until 8 October 2026 the first goal
// started nothing with the original assistant: setup filed the goal and saved the clock, and the
// book's three routines never ran unless a reader built them by hand.
//
// They are Hermes jobs that run the mission control's own programs and recipes, the ones an owner's
// schedule runs (mc-decide with the next-action recipe, mc-work-run with the work-item recipe,
// mc-due, the coach), never replacements for them. NativeScheduler (native-scheduler.mjs) decides
// when they are made; this file says what they are, writes the scripts Hermes runs, prepares the
// coach's check-in, and keeps what a routine said on a computer where it would reach nobody.

// The one record that says the starting routines were made, or why not. Written once; a reader who
// later removes a routine never gets it back.
export const FLAG='starting-routines';
// Where a routine's reply is kept on a computer without a messenger.
export const RESULTS_FOLDER='From your routines';
export const CHECK_IN={slug:'weekly-check-in',title:'Weekly check-in',rhythm:'weekly sunday',time:'18:00',style:'review',tone:'gentle'};
const CHECK_IN_PREPARATION='Read the goals it serves and any other adopted goal (mc-goals list shows them), what the daily round did for them since the last talk (the decision records under routines/next-action/) and the last talk of this area. Choose one thing that moved or is stuck, in plain words. Then one question about it.';

export const STARTING_ROUTINES=[
 {key:'decide',name:'Daily round: choose today\'s work',schedule:'30 5 * * *',script:'godspeed-daily-round-choose.py',what:'Every morning at 05:30 it picks today\'s work on your goals, up to three of them, and tells you the one thing that needs you, if there is one. With a morning brief switched on, the brief tells you instead.'},
 {key:'work',name:'Daily round: do the work',schedule:'0 10,16 * * *',script:'godspeed-daily-round-work.py',what:'At 10:00 and 16:00 it does the work the morning picked, one piece at a time, checks each result, and tells you when something is ready for you to read.'},
 {key:'due',name:'Deadline reminders',schedule:'0 8 * * *',script:'godspeed-deadline-reminders.py',what:'Every morning at 08:00 it tells you about the dates that need a mention today, and stays quiet on other days. With a morning brief switched on, your dates are in the brief instead.'},
 {key:'coach-gate',name:NOTEBOOK_TALK_JOB,schedule:'*/15 * * * *',script:'godspeed-coach-talks.py',prompt:TALK_PROMPT,what:'Opens your weekly check-in about your goal, Sundays at 18:00, and any other talk you ask for. It looks every 15 minutes whether one is due.'},
 {key:'coach-tick',name:NOTEBOOK_TICK_JOB,schedule:'*/15 * * * *',script:'godspeed-coach-reminders.py',what:'Sends the one reminder after a talk you did not answer, and the evening habit check once you agree on a habit.'},
];

// This machine's own record of the starting routines in its Hermes, beside the notebook's other
// machine state (.godspeed, which never travels with the folder): {state: created | skipped |
// pending, jobs, ...}. Hermes' routines live in each machine's Hermes, so whether a machine got
// them is that machine's fact, not the mission control's.
const machineFile=store=>path.join(store.state,'starting-routines.json');
export function readMachineRecord(store){try{const record=JSON.parse(fs.readFileSync(machineFile(store),'utf8'));return record&&typeof record==='object'?record:null;}catch{return null;}}
export function writeMachineRecord(store,record){atomic(machineFile(store),JSON.stringify(record,null,2)+'\n');}
// A messenger this machine's Hermes can send to (the coach's own test: a Telegram bot in its .env).
export function telegramInHermes(home){try{return /^\s*TELEGRAM_BOT_TOKEN\s*=\s*\S+/m.test(fs.readFileSync(path.join(home,'.env'),'utf8'));}catch{return false;}}

const kit=fileURLToPath(new URL('../../',import.meta.url));
const runner=fileURLToPath(new URL('./routine-scripts/godspeed_routines.py',import.meta.url));

// Hermes runs only scripts in its own scripts folder, with its own Python on every system.
export function routineFiles({root,home,state,timezone,node=process.execPath,hermes=null}){
 // tools: the kit's own programs (mc-decide, mc-work-run, due.js), run where they are; bin: the
 // assistant's command folder, first on the path for the recipes they run.
 const config={root,home,bin:path.join(home,'bin'),tools:path.join(kit,'tools'),node,hermes:hermes&&path.isAbsolute(hermes)?hermes:null,coach:path.join(kit,'third-party','addons','godspeed-coach','bin','godspeed-coach.mjs'),coach_app:path.join(state,'coach-app'),timezone};
 const files={'godspeed_routines.py':fs.readFileSync(runner,'utf8').replace(/\r\n/g,'\n'),'godspeed-routines.json':JSON.stringify(config,null,2)+'\n'};
 for(const routine of STARTING_ROUTINES)files[routine.script]='# Written by the Godspeed Mission Control notebook for the routine "'+routine.name+'".\n# The notebook writes it again when its own folders change; the work is in godspeed_routines.py.\nfrom godspeed_routines import main\n\nmain('+JSON.stringify(routine.key)+')\n';
 return files;
}
export function writeRoutineFiles(home,files){
 const folder=path.join(home,'scripts');let changed=0;
 for(const [name,text] of Object.entries(files)){const file=path.join(folder,name);if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===text)continue;atomic(file,text);changed++;}
 return changed;
}

// The weekly check-in is a coach talk about the goal. The coach's clock is the installation's (its
// own default is UTC, so "Sunday at six" was read on the wrong clock), and without a messenger the
// talk waits in the chat instead of being refused.
export function prepareCheckIn(root,{timezone,delivery,goal,now=new Date()}){
 const settings=coachSettings(root);
 // This machine now opens the talks (a server that took the routines over included).
 saveCoach(root,{...settings,timezone,talk_delivery:delivery==='telegram'?'messenger':'chat',tick_host:os.hostname()});
 if(findArea(root,CHECK_IN.slug))return null;
 return addArea(root,{...CHECK_IN,starts:addDays(localParts(now,timezone).date,1),serves:goal||'',preparation:CHECK_IN_PREPARATION});
}

// WHEN THE TWO COACH ROUTINES REALLY RUN, for Settings > Routines. Both wake every 15 minutes to
// look, and until 9 October 2026 their rows said exactly that ("Runs every 15 minutes."), so the
// weekly check-in read as a talk every quarter of an hour. The check-in's row now says the day and
// time of its talks, from the coach's areas, and the next talk; the reminders say what they look for.
// {rhythm, next_talk} for those two jobs, {} for any other.
export function coachRoutineTimes(job,root,{now=new Date()}={}){
 const name=String(job.title||''),every=/^\*\/(\d+) \* \* \* \*$/.exec(String(job.schedule||'').trim());
 if(name===NOTEBOOK_TICK_JOB||name===TICK_JOB)return every?{rhythm:'Checks every '+every[1]+' minutes for a due reminder or habit question.'}:{};
 if(name!==NOTEBOOK_TALK_JOB&&name!==TALK_JOB)return {};
 let areas=[];try{areas=listAreas(root).filter(a=>a.on&&a.rhythm);}catch{}
 if(!areas.length)return {};
 areas.sort((a,b)=>(b.slug===CHECK_IN.slug)-(a.slug===CHECK_IN.slug)||a.slug.localeCompare(b.slug));
 const words=areas.length===1?rhythmWords(areas[0]):areas.map(a=>rhythmWords(a)+' for '+a.title).reduce((all,one,i,list)=>all+(i===0?'':i===list.length-1?' and ':', ')+one,'');
 const timezone=coachSettings(root).timezone||'UTC',today=localParts(now,timezone).date;
 const moments=areas.map(a=>{for(let from=today,i=0;i<2;i++,from=addDays(from,1)){const day=nextTalkDay(a,from);if(!day)return null;const at=zonedToUtc(day,a.time,timezone);if(at>now)return at;}return null;}).filter(Boolean).sort((a,b)=>a-b);
 return {rhythm:'Runs '+words+'.',...(moments.length?{next_talk:moments[0].toISOString()}:{})};
}

// What Hermes itself adds to a reply, which is never what the routine said to the person
// (9 October 2026, a live run: the daily round's whole note was Hermes' "File-mutation verifier"
// block). The same list as godspeed_routines.py TRAILERS: the verifier's header with its bullet
// lines, a repaired tool name Hermes printed, a notice that replaced a reply the model never
// finished (to the end of the reply), and a network notice.
const TRAILERS=[
 /^[ \t]*(?:⚠️?[ \t]*)?File-mutation verifier:.*(?:\n[ \t]+(?:•|-|\*).*)*/gm,
 /^[ \t]*\u{1f527}[ \t]*Auto-repaired tool name:.*$/gmu,
 /^[ \t]*⚠️?[ \t]*(?:No reply:|\*\*Response Stopped|\*\*No visible answer)[\s\S]*/m,
 /^[ \t]*\u{1f501}[ \t]*Response dominated by repeated text.*$/gmu,
 /^[ \t]*\[System: [^\]\n]*\][ \t]*$/gm,
];
export function stripTrailers(text){
 let out=String(text||'').replace(/\r\n/g,'\n');
 for(const pattern of TRAILERS)out=out.replace(pattern,'');
 return out.replace(/\n{3,}/g,'\n\n').trim();
}
// The person-facing reply of one Hermes run document (cron/output/<job>/<time>.md), or null when it
// was silent, failed or said nothing. Hermes keeps it there and sends it nowhere when the delivery
// is "local", which is every routine on a computer without a messenger.
const SILENT=/^\[?\s*silent\s*\]?$|^no[_ ]reply$/i;
export function finalReply(text){
 text=String(text||'').replace(/\r\n/g,'\n');let reply=null;
 const response=text.lastIndexOf('\n## Response\n\n');
 if(response!==-1)reply=text.slice(response+'\n## Response\n\n'.length);
 else if(/^\*\*Mode:\*\* no_agent/m.test(text)){const cut=text.indexOf('\n---\n\n');if(cut!==-1)reply=text.slice(cut+'\n---\n\n'.length);}
 reply=stripTrailers(reply);if(!reply||reply==='(No response generated)')return null;
 const lines=reply.split('\n').map(l=>l.trim()).filter(Boolean);
 if(SILENT.test(reply)||SILENT.test(lines[0])||SILENT.test(lines.at(-1)))return null;
 return reply;
}

// A daily-round routine that went wrong prints its one sentence for the person like any other line
// (godspeed_routines.py, tell), so Hermes records the run as having worked. Its own record beside
// Hermes' says it failed, and Settings > Routines says so: {last_status, last_error} for the row
// of that run, {} otherwise. Only the record written by that very run counts.
export const ROUTINE_STATUS='godspeed-routines-status.json';
export function routineStatus(home,job){
 const routine=STARTING_ROUTINES.find(r=>r.script===job?.script);if(!routine||!job.last_run_at)return {};
 let status;try{status=JSON.parse(fs.readFileSync(path.join(home,ROUTINE_STATUS),'utf8'))?.[routine.key];}catch{return {};}
 const ran=Date.parse(job.last_run_at),at=Date.parse(status?.at);
 if(!status?.failed||!Number.isFinite(ran)||!Number.isFinite(at)||Math.abs(ran-at)>10*60000)return {};
 return {last_status:'error',last_error:String(status.failed).slice(0,500)};
}
const runWords=(day,time)=>new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(day+'T00:00:00Z'))+', '+time.slice(0,5).replace('-',':');

// A job whose replies reach nobody: "local", or "origin" with no chat it came from and no
// messenger to fall back to (a routine asked for in the notebook's chat on a computer).
export function reachesNobody(job,{messenger=false}={}){
 const deliver=String(job.deliver||'').trim();
 return deliver==='local'||(!deliver||deliver==='origin')&&!job.origin&&!messenger;
}

// After each tick on the machine that runs the routines of a mission control made from the starter
// (NativeScheduler.tick decides that): every new reply of a Hermes job whose replies reach nobody
// becomes one note in "From your routines", whoever made the job (the starting routines, a routine
// asked for in the chat, or Settings > Routines). Silent and failed runs are skipped. A run is
// saved once: its note's name comes from the run, and what was read is remembered in this
// machine's own state. Runs from before this machine started keeping them are left alone, so an
// older installation does not get a backlog of notes at once.
export function saveRoutineResults(store,{home,jobs,messenger=false,now=Date.now()}){
 const progressFile=path.join(store.state,'routine-results.json');let progress=null;
 try{progress=JSON.parse(fs.readFileSync(progressFile,'utf8'));}catch{}
 const started=!progress||typeof progress.since!=='string'||typeof progress.jobs!=='object'||!progress.jobs;
 if(started)progress={since:new Date(now).toISOString(),jobs:{}};
 const before=started?'':JSON.stringify(progress),since=Date.parse(progress.since),saved=[];
 for(const job of jobs){
  if(!job?.id||!/^[A-Za-z0-9_-]+$/.test(job.id)||!reachesNobody(job,{messenger}))continue;
  const folder=path.join(home,'cron','output',job.id);if(!fs.existsSync(folder))continue;
  for(const name of fs.readdirSync(folder).filter(n=>/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/.test(n)).sort()){
   if(progress.jobs[job.id]&&name<=progress.jobs[job.id])continue;
   const file=path.join(folder,name);progress.jobs[job.id]=name;
   // A file's time comes from the system's coarse clock and can trail Date.now() by a few milliseconds,
   // so a run written right after the first look could read as older and be lost: allow two seconds.
   if(fs.statSync(file).mtimeMs<since-2000)continue;
   const reply=finalReply(fs.readFileSync(file,'utf8'));if(!reply)continue;
   const id='routine-result-'+hash(job.id+'/'+name).slice(0,20);if(store.get('notes',id))continue;
   const [day,time]=name.slice(0,-3).split('_');
   saved.push(store.save('notes',{id,title:(job.name||'Routine')+', '+runWords(day,time),content:reply,folder_path:RESULTS_FOLDER,source_app:'routine',routine_id:job.id,observation_day:day}));
  }
 }
 if(JSON.stringify(progress)!==before)atomic(progressFile,JSON.stringify(progress));
 return saved;
}
