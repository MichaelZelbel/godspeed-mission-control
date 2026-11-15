import fs from 'node:fs';
import path from 'node:path';
import {cardCommand} from './card-commands.mjs';
import {readMachineRecord} from './starting-routines.mjs';
import {localParts} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// THE GOALS PAGE, ONE READING (18 October 2026). Until now a goal was a box inside Settings with
// its title, its status and the words the person typed, and nothing of what the loop did: not its
// weekly number or the readings over time, not the bets the morning decision made on that number or
// their verdicts, not today's decision, the work done and whether its check passed, what went out,
// or the research brief and the limit it names. All of that is on file, written by the programs that
// run the loop (mc-goals, mc-work, the decision's own record), and this reads it back in one place,
// writing nothing. The programs read it the same way in either runtime (cardCommand).
const DAY=/^\d{4}-\d{2}-\d{2}$/;
function sectionOf(markdown,heading){
 const text=String(markdown||'').replace(/\r/g,''),at=text.search(new RegExp('^## '+heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'[ \\t]*$','m'));
 if(at<0)return '';
 return text.slice(at).split('\n').slice(1).join('\n').split(/\n## /)[0].trim();
}
// The newest decision record on or before the day: routines/next-action/<day>/decision.md.
function latestDecision(root,today){
 const folder=path.join(root,'routines','next-action');let days=[];
 try{days=fs.readdirSync(folder).filter(d=>DAY.test(d)&&d<=today).sort();}catch{}
 for(const day of days.reverse()){
  try{const text=fs.readFileSync(path.join(folder,day,'decision.md'),'utf8');if(text.trim())return {day,text,standin:text.includes('did not finish and wrote no record of its own')};}catch{}
 }
 return null;
}
const last=(log,event)=>{for(let i=(log||[]).length-1;i>=0;i--)if(log[i].event===event)return log[i];return null;};
// One work item as the page shows it, from mc-work's own card.
export function workItem(row){
 const log=row.log||[],verified=last(log,'VERIFIED'),unverified=last(log,'UNVERIFIED'),failed=last(log,'FAILED'),stopped=last(log,'STOPPED');
 return {id:row.id,what:row.WHAT||'',status:row.STATUS||'',kind:row.KIND||'do',goal:row.GOAL||'',done_when:row['DONE WHEN']||'',check:row.CHECK||'',
  outward:row.OUTWARD==='yes',standing:row.MAY||'',approved:row.APPROVED||'',goes_out:row['GOES OUT']||'',announced:row.ANNOUNCED||'',needs:row.NEEDS||'none',
  result:row.RESULT||'',link:row.LINK||'',filed:row.FILED||'',next_try:row['NEXT TRY']||'',
  verified:verified?{date:verified.date,how:verified.rest}:null,unverified:unverified&&(!verified||unverified.date>=verified.date)?{date:unverified.date,why:unverified.rest}:null,
  failed:failed?{date:failed.date,why:failed.rest}:null,stopped:stopped?{date:stopped.date,words:stopped.rest}:null};
}
const run=(store,card,args)=>{const out=String(cardCommand(store,{card,args}).result||'');try{return JSON.parse(out);}catch{}try{return JSON.parse(out.split('\n').filter(Boolean).at(-1)||'null');}catch{return null;}};
// The routines a first goal starts, by their key (starting-routines.mjs), with when each runs next.
function routineTimes(store,query){
 const made=new Map((readMachineRecord(store)?.jobs||[]).map(j=>[j.id,j.key])),out={};
 let jobs=[];try{jobs=query.rows('jobs');}catch{}
 for(const job of jobs){const key=made.get(job.id);if(key)out[key]={id:job.id,name:job.title,next_run:job.next_run||null,last_run:job.last_run_at||null,last_status:job.last_status||null,last_error:job.last_error||null,paused:!!job.paused};}
 return out;
}
export function goalOverview({store,query,now=new Date()}){
 const timezone=store.get('settings','installation')?.timezone||'UTC',today=localParts(now,timezone).date;
 const goals=run(store,'goals',['status','--json','--date',today])||[];
 const work=(run(store,'work',['list','--all','--json'])||[]).map(workItem);
 const going=run(store,'work',['going-out','--json'])||[];
 const decision=latestDecision(store.root,today);
 const byId=new Map(work.map(w=>[w.id,w]));
 return {
  today,timezone,
  decision:decision?{day:decision.day,today:decision.day===today,finished:!decision.standin,for_you:sectionOf(decision.text,'For you today'),scoreboard:sectionOf(decision.text,'Scoreboard'),next:sectionOf(decision.text,'Next decision')}:null,
  routines:routineTimes(store,query),
  going_out:going.map(g=>({n:g.n,id:g.id,what:g.what,goal:g.goal,at:g.at,shown:!!g.announced})),
  goals:goals.map(g=>({...g,
   bets:g.bets.map(b=>({...b,what:byId.get(b.work)?.what||b.title||''})),
   decision:decision?sectionOf(decision.text,g.id):'',
   work:work.filter(w=>w.goal===g.id).sort((a,b)=>String(b.filed).localeCompare(String(a.filed))||b.id.localeCompare(a.id)),
  })),
 };
}
