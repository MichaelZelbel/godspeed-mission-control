// Habits on the Trackers shelf (D-321, step 3). A habit stays the coach's: one file,
// coach/<area>/habits/<slug>.md, whose day lines the evening check, its follow-up, the graduation
// verdict, the AUTO checks and the [godspeed-coach] block all read and write, on the bot, in the
// notebook and in the add-on on its own. So the notebook keeps no copy of a habit day. It shows
// each habit as a tracker made from that file (specialist "habit"), and every change it makes,
// from "track walk to work" or from the shelf, runs the coach's own track() or untrack() on the
// same file, keeping the earlier version in coach/history as every notebook coach write does.
import fs from 'node:fs';
import {listHabits,track,untrack,setStatus,setHabitSchedule,setHabitDisplay,exemptHabitDays} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';
import {addDays,localParts,now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
import {habitProgress,assertDay} from '../../third-party/addons/godspeed-coach/lib/progress.mjs';
import {hash} from './records/store.mjs';
import {rememberFile} from './native-personal.mjs';
import {norm,longDay,whenFor} from './trackers.mjs';

export const habitId=h=>'habit-'+h.area+'-'+h.slug;
const ANSWERS=['done','no','skip'],SAID={done:'done',no:'not done',skip:'skipped'};
const habitNames=h=>[...new Set([h.title,h.slug.replaceAll('-',' ')].filter(Boolean))];
const habitsOf=store=>store?.root?listHabits(store.root):[];
// A habit by its tracker id, or by its title or slug said in full. Two that fit are named, never guessed.
export function findHabits(store,ref){
 const named=norm(ref);if(!named)return [];
 const all=habitsOf(store),byId=all.filter(h=>habitId(h)===String(ref).trim());if(byId.length)return byId;
 return all.filter(h=>habitNames(h).some(n=>norm(n)===named));
}
export const isHabitRef=(store,ref)=>findHabits(store,ref).length>0;
// Answered days only: an "asked" line records the evening check, not a day he tracked.
const answered=h=>Object.entries(h.log).filter(([,v])=>v.answer).sort(([a],[b])=>a.localeCompare(b)).map(([when,v])=>({id:when,when,data:{answer:v.answer,...(v.words?{note:v.words}:{}),...(v.source?{source:v.source}:{})}}));
// The day of the newest answer line in the file: the one he tracked or changed last.
function lastAnswered(h){
 const lines=fs.readFileSync(h.file,'utf8').split('\n');
 for(let i=lines.length-1;i>=0;i--){const m=lines[i].match(/^- (\d{4}-\d{2}-\d{2}) (done|no|skip) /);if(m)return m[1];}
 return null;
}
// Each habit as tracker-list gives a tracker: active ones on the shelf, the others resting.
export function habitTrackerList(store,{today,from,now=clockNow(),zone=store.get('settings','installation')?.timezone||'UTC',calendarDays=14}={}){
 return habitsOf(store).map(h=>{
  const progress=habitProgress(h,{now,timezone:zone,calendarDays});
  const days=answered(h),last=days.at(-1),todays=days.find(d=>d.when===progress.today);
  return {id:habitId(h),name:h.title,names:habitNames(h),cadence:h.days==='daily'?'daily':'scheduled',days:h.days,daysText:h.daysText,started:h.started,doneMeans:h.doneMeans,progress,talk:h.area,specialist:'habit',status:h.status==='active'?'active':'resting',habit_status:h.status,hash:hash(fs.readFileSync(h.file)),
   fields:[{key:'answer',label:'Done?',type:'select',options:[...ANSWERS]},{key:'note',label:'Note',type:'text'}],
   last:last?{id:last.id,when:last.when,data:last.data,hash:null}:null,today:todays?{id:todays.id,hash:null}:null,
   ...(from?{recent:days.filter(d=>d.when>=from).map(d=>({...d,hash:null}))}:{})};
 });
}
const lower=s=>String(s).charAt(0).toLowerCase()+String(s).slice(1);
const dayWords=(day,today)=>day===today?'today':day===addDays(today,-1)?'yesterday':'on '+longDay(day);
// Both direct assistant tools and conversation proposals use the same narrow authorization.
// Reading progress never authorizes a display change, nor does mentioning illness authorize
// an invented date range. The owner's explicit UI controls do not need language interpretation.
export function assertHabitProgressRequest(store,input,{now=clockNow(),zone=store.get('settings','installation')?.timezone||'UTC',message}={}) {
 const h=findHabits(store,input.tracker)[0];if(!h)throw Error('Choose an existing habit');
 if(input.action==='show')return;
 const words=String(message??input.words??input.source_quote??'').trim(),said=norm(words);
 if(/\b(?:if I|suppose|hypothetically|for example|someone said|quoted|wenn ich|beispielsweise)\b/iu.test(words)||/\b(?:don.t|do not|never|nicht|niemals)\s+(?:pause|resume|restart|continue|excuse|exempt|change|switch|set|hide|pausiere|ändere)/iu.test(words))throw Error('The habit change needs an explicit request, not a refusal or example');
 if(!habitNames(h).concat(habitId(h)).some(name=>(' '+said+' ').includes(' '+norm(name)+' ')))throw Error('The request must name the habit to change');
 const checks={display:input.display==='calm'?/\b(?:switch|use|enable|set|change|hide|turn|wechsel|nutze|aktiviere|ändere|ausblenden)\b[\s\S]*(?:calm|display|streak|ruhig|anzeige)/iu:/\b(?:switch|use|enable|set|change|turn|wechsel|nutze|aktiviere|ändere)\b[\s\S]*(?:standard|display|streak|anzeige)/iu,pause:/\b(?:pause|stop|pausiere)\b/iu,resume:/\b(?:resume|restart|continue|fortsetzen|starte)\b/iu,exempt:/\b(?:exempt|excuse|exclude|disregard|entschuldige|ausnehmen)\b|(?:don.t|do not|nicht)\s+(?:count|zählen)/iu,schedule:/\b(?:change|set|switch|move|reschedule|ändere|wechsel|verschiebe)\b[\s\S]*(?:schedule|days|daily|every|mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|täglich|tage|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)/iu};
 if(!checks[input.action]?.test(words))throw Error('The habit change must be the one explicitly requested');
 if(input.action==='display') {
  const selected=input.display==='calm'?/\b(?:calm|ruhig|hide|ausblenden)\b/iu:/\b(?:standard|normal)\b|\b(?:enable|activate|turn on|aktiviere)\b[\s\S]*(?:streak|display|anzeige)/iu;
  if(!selected.test(words))throw Error('Use only the display the person requested');
 }
 const today=localParts(now,h.timezone||zone).date;
 const namedDate=date=>words.includes(date)||(date===today&&/\b(?:today|heute)\b/iu.test(words))||(date===addDays(today,-1)&&/\b(?:yesterday|gestern)\b/iu.test(words));
 for(const key of input.action==='exempt'?['from','to']:['on'])if(input[key]&&!namedDate(input[key]))throw Error('Use only dates the person named for this habit change');
 if(input.action==='exempt'&&!input.from)throw Error('An exemption needs the first date the person named');
 if(input.action==='schedule'){
  const requested=Array.isArray(input.days)?input.days:String(input.days||'').toLowerCase().split(/[\s,]+/);
  const names={mon:/\b(?:mon(?:day)?|montag)\b/iu,tue:/\b(?:tue(?:sday)?|dienstag)\b/iu,wed:/\b(?:wed(?:nesday)?|mittwoch)\b/iu,thu:/\b(?:thu(?:rsday)?|donnerstag)\b/iu,fri:/\b(?:fri(?:day)?|freitag)\b/iu,sat:/\b(?:sat(?:urday)?|samstag)\b/iu,sun:/\b(?:sun(?:day)?|sonntag)\b/iu,daily:/\b(?:daily|every day|täglich|jeden tag)\b/iu};
  if(!requested.length||requested.some(day=>!names[String(day).slice(0,3)==='dai'?'daily':String(day).slice(0,3)]?.test(words)))throw Error('Use only schedule days the person requested');
 }
}
// track and tracker-correct on a habit. `today` is the installation's day. The coach keeps the
// person's words with the day: the chat's message, or `words` over MCP. An assistant that tracks a
// habit without them is refused (until 12 October 2026 the bot's "track walk to work" wrote an
// empty quote); the owner's own clicks on the shelf need none.
export function habitOperation(store,input,{now,zone,today,assistant=false,evidence=null}){
 const found=findHabits(store,input.tracker);
 if(found.length>1)throw Error('Which one: '+found.map(h=>h.title).sort().join(' or ')+'?');
 const h=found[0];if(!h)throw Error('No habit called '+input.tracker);
 const expected=typeof input.expected==='string'?input.expected:input.expected?.['habits/'+habitId(h)]??input.expected?.[habitId(h)]??input.expected_hash;
 if(expected!==undefined&&expected!==hash(fs.readFileSync(h.file)))throw Error('This habit changed; reload its progress before saving');
 zone=h.timezone||zone;today=localParts(now,zone).date;
 h.progressTimezone=zone;
 const result=(updated,data)=>({...data,progress:habitProgress(updated,{now,timezone:zone}),habit:{id:habitId(updated),name:updated.title,status:updated.status,doneMeans:updated.doneMeans,days:updated.days,daysText:updated.daysText,started:updated.started,progress:habitProgress(updated,{now,timezone:zone})}});
 const words=String(input.note??input.words??input.source_quote??'').trim(),name=lower(h.title);
 if(input.type==='habit-progress'){
  if(input.action==='show'){const total=habitProgress(h,{now,timezone:zone}).lifetimeCompletedDays;return result(h,{habit_id:habitId(h),action:'show',reply:h.title+': '+total+' completed '+(total===1?'day':'days')+' altogether.'});}
  if(assistant)assertHabitProgressRequest(store,input,{now,zone});
  if(assistant&&!words)throw Error("Pass the person's own message as words");
  const action=input.action;let updated;
  if(action==='display') {if(!['standard','calm'].includes(input.display))throw Error('Choose standard or calm display');rememberFile(store,h.file);updated=setHabitDisplay(h,input.display);}
  else if(action==='pause'||action==='resume') {const on=assertDay(input.on||today);if(on>today)throw Error('Use a dated exemption for a future holiday');rememberFile(store,h.file);updated=setStatus(h,action==='pause'?'paused':'active',on);
   // The native button service supplies this trusted context directly, never as model input.
   if(evidence&&/^telegram-button:[a-f0-9]{32}$/.test(evidence.source))fs.appendFileSync(h.file,'\n<!-- '+JSON.stringify({source:evidence.source,action,on,evidence:'Telegram button tap'})+' -->\n');
  }
  else if(action==='schedule') {const on=assertDay(input.on||today);if(on>today)throw Error('A schedule change starts today or on a past date');rememberFile(store,h.file);updated=setHabitSchedule(h,input.days,on,zone);}
  else if(action==='exempt') {const from=assertDay(input.from),to=assertDay(input.to||from);if(to<from)throw Error('The last day must come after the first day');rememberFile(store,h.file);updated=exemptHabitDays(h,from,to,words);}
  else throw Error('Choose display, pause, resume, schedule or exempt');
  return result(updated,{habit_id:habitId(h),action,reply:action==='display'?h.title+' now uses the '+input.display+' display.':action==='pause'?h.title+' is paused.':action==='resume'?h.title+' is active again.':action==='schedule'?'Changed the schedule for '+name+'.':'Those days do not count against '+name+'.'});
 }
 if(assistant&&!words&&(input.type==='track'||input.remove!==true))throw Error("Pass the person's own message as words: the habit keeps them with the day.");
 if(input.type==='track'){
  const answer=input.answer??'done';if(!ANSWERS.includes(answer))throw Error('A habit day is done, no or skip');
  const day=whenFor({on:input.on,cadence:'daily'},now,zone);
  assertDay(day);if(day>today)throw Error('A completion cannot be recorded in the future');
  rememberFile(store,h.file);const updated=track(h,day,answer,input.source||'notebook',words);
  return result(updated,{habit_id:habitId(h),day,answer,reply:'Tracked: '+name+', '+SAID[answer]+' '+dayWords(day,today)+'.'});
 }
 const day=input.entry_id||lastAnswered(h);if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error(h.title+' has no tracked day yet');
 const before=h.log[day]?.answer;if(!before)throw Error('No answer is tracked for '+day);
 if(input.remove===true){rememberFile(store,h.file);const updated=untrack(h,day);return result(updated,{habit_id:habitId(h),day,removed:true,reply:'Removed: '+name+', '+SAID[before]+' '+dayWords(day,today)+'.'});}
 const answer=input.answer??input.value;if(!ANSWERS.includes(answer))throw Error('A habit day is done, no or skip');
 const correctedWords=input.note===undefined&&input.words===undefined&&input.source_quote===undefined?h.log[day]?.words||'':words;
 rememberFile(store,h.file);const updated=track(h,day,answer,input.source||'notebook',correctedWords);
 return result(updated,{habit_id:habitId(h),day,answer,removed:false,reply:'Changed: '+name+' is '+SAID[answer]+' '+dayWords(day,today)+'.'});
}
