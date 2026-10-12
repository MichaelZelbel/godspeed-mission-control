// Habits on the Trackers shelf (D-321, step 3). A habit stays the coach's: one file,
// coach/<area>/habits/<slug>.md, whose day lines the evening check, its follow-up, the graduation
// verdict, the AUTO checks and the [godspeed-coach] block all read and write, on the bot, in the
// notebook and in the add-on on its own. So the notebook keeps no copy of a habit day. It shows
// each habit as a tracker made from that file (specialist "habit"), and every change it makes,
// from "track walk to work" or from the shelf, runs the coach's own track() or untrack() on the
// same file, keeping the earlier version in coach/history as every notebook coach write does.
import fs from 'node:fs';
import {listHabits,track,untrack} from '../../third-party/addons/godspeed-coach/lib/habits.mjs';
import {addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';
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
export function habitTrackerList(store,{today,from}={}){
 return habitsOf(store).map(h=>{
  const days=answered(h),last=days.at(-1),todays=days.find(d=>d.when===today);
  return {id:habitId(h),name:h.title,names:habitNames(h),cadence:'daily',talk:h.area,specialist:'habit',status:h.status==='active'?'active':'resting',habit_status:h.status,hash:hash(fs.readFileSync(h.file)),
   fields:[{key:'answer',label:'Done?',type:'select',options:[...ANSWERS]},{key:'note',label:'Note',type:'text'}],
   last:last?{id:last.id,when:last.when,data:last.data,hash:null}:null,today:todays?{id:todays.id,hash:null}:null,
   ...(from?{recent:days.filter(d=>d.when>=from).map(d=>({...d,hash:null}))}:{})};
 });
}
const lower=s=>String(s).charAt(0).toLowerCase()+String(s).slice(1);
const dayWords=(day,today)=>day===today?'today':day===addDays(today,-1)?'yesterday':'on '+longDay(day);
// track and tracker-correct on a habit. `today` is the installation's day. The coach keeps the
// person's words with the day: the chat's message, or `words` over MCP. An assistant that tracks a
// habit without them is refused (until 12 October 2026 the bot's "track walk to work" wrote an
// empty quote); the owner's own clicks on the shelf need none.
export function habitOperation(store,input,{now,zone,today,assistant=false}){
 const found=findHabits(store,input.tracker);
 if(found.length>1)throw Error('Which one: '+found.map(h=>h.title).sort().join(' or ')+'?');
 const h=found[0];if(!h)throw Error('No habit called '+input.tracker);
 const words=String(input.note??input.words??input.source_quote??'').trim(),name=lower(h.title);
 if(assistant&&!words&&(input.type==='track'||input.remove!==true))throw Error("Pass the person's own message as words: the habit keeps them with the day.");
 if(input.type==='track'){
  const answer=input.answer??'done';if(!ANSWERS.includes(answer))throw Error('A habit day is done, no or skip');
  const day=whenFor({on:input.on,cadence:'daily'},now,zone);
  rememberFile(store,h.file);track(h,day,answer,input.source||'notebook',words);
  return {habit_id:habitId(h),day,answer,reply:'Tracked: '+name+', '+SAID[answer]+' '+dayWords(day,today)+'.'};
 }
 const day=input.entry_id||lastAnswered(h);if(!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error(h.title+' has no tracked day yet');
 const before=h.log[day]?.answer;if(!before)throw Error('No answer is tracked for '+day);
 if(input.remove===true){rememberFile(store,h.file);untrack(h,day);return {habit_id:habitId(h),day,removed:true,reply:'Removed: '+name+', '+SAID[before]+' '+dayWords(day,today)+'.'};}
 const answer=input.answer??input.value;if(!ANSWERS.includes(answer))throw Error('A habit day is done, no or skip');
 rememberFile(store,h.file);track(h,day,answer,input.source||'notebook',words);
 return {habit_id:habitId(h),day,answer,removed:false,reply:'Changed: '+name+' is '+SAID[answer]+' '+dayWords(day,today)+'.'};
}
