import {kinds} from './scheduler.mjs';
import {nextCalendarRun} from './calendar.mjs';
import {dailyTime} from '../native-scheduler.mjs';

// Controls edit schedule choices only. Execution authority and receipts have
// their own operations and cannot be supplied through Pause or Enable.
export async function controlRoutine(store,input,{enable=false,now=Date.now()}={}){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Choose a routine');
 const allowed=enable?['kind','interval_ms','at','title','discovery']:['id','paused'];
 if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Routine controls cannot change execution permission');
 if(enable){
  if(input.at!==undefined&&!dailyTime(input.at))throw Error('Choose a daily time as hours and minutes, like 05:16');
  if(!kinds.includes(input.kind)||input.at===undefined&&(!Number.isFinite(input.interval_ms)||input.interval_ms<60000))throw Error('Choose a supported routine and a daily time or an interval of at least a minute');
  if(input.title!==undefined&&typeof input.title!=='string')throw Error('Choose a routine title');
  if(input.discovery!==undefined&&(input.kind!=='radar'||typeof input.discovery!=='boolean'))throw Error('Choose whether radar may discover public sources');
 }else if(typeof input.id!=='string'||typeof input.paused!=='boolean')throw Error('Choose whether to pause the routine');
 return store.withLockAsync(()=>{
  const settings=store.get('settings','installation'),id=enable?input.kind:input.id,old=store.get('jobs',id);
  if(!settings)throw Error('Complete setup first');
  // Authenticated paired notebooks may edit choices on any machine. Execution
  // still belongs to the installation owner and the scheduler checks its device.
  if(!settings.owner||old&&old.owner!==settings.owner)throw Error('The routine owner differs from the installation owner');
  if(!enable&&!old)throw Error('Routine not found');
  const resume=enable||input.paused===false;
  // A daily time runs once a day at that time in the owner's timezone (jobs/calendar.mjs).
  const calendar=input.at!==undefined?{time:dailyTime(input.at).time}:null;
  let changes=enable?{id,kind:input.kind,...(calendar?{calendar,interval_ms:86400000}:{interval_ms:input.interval_ms}),paused:false,...(!old?{owner:settings.owner,title:input.title||input.kind,state:'pending',next_run:calendar?nextCalendarRun({calendar},settings.timezone,now):new Date(now).toISOString(),retry_count:0}:calendar?{next_run:nextCalendarRun({calendar},settings.timezone,now)}:{}),...(input.title!==undefined?{title:input.title}:{}),...(input.kind==='radar'&&(input.discovery!==undefined||!old)?{discovery:input.discovery!==false}:{})}:{paused:input.paused};
  if(old&&resume)changes={...changes,...resumeChanges(store,settings,old,now)};
  const record=store.prepare('jobs',changes,old);store.commit([record]);return record;
 });
}
// What resuming a routine changes, or why it may not resume. Every resume goes
// through here: routine-change (personal-operations.mjs) wrote paused:false
// straight onto the job until 6 October 2026, so a routine whose delivery was
// uncertain resumed and its next run sent the message again.
export function resumeChanges(store,settings,old,now=Date.now()){
 const receipts=store.list('job_receipts').filter(r=>r.job_id===old.id);
 const failed=old.state==='failed'||old.state==='needs_review';
 const slotReceipt=receipts.find(r=>r.id===old.id+'-'+Date.parse(old.next_run));
 const completedFailure=receipts.some(r=>r.state==='failed'&&Number.isFinite(Date.parse(r.finished_at)));
 const failedSlot=slotReceipt?.state==='failed';
 const uncertain=receipts.some(r=>r.state==='attempted')
  ||(failed||failedSlot)&&(old.outward||settings.delivery!=='notebook')
  ||failed&&!completedFailure
  ||failedSlot&&!Number.isFinite(Date.parse(slotReceipt.finished_at));
 if(old.state==='awaiting_approval'||uncertain)throw Error('This routine needs its previous attempt reviewed before it can resume');
 if(!failed&&!failedSlot)return {};
 // Each scheduler receipt is keyed by the millisecond slot. Reuse none of
 // those slots, even if multiple explicit requests share the same clock tick.
 let at=now;const used=new Set(receipts.map(r=>r.id));
 while(used.has(old.id+'-'+at))at++;
 return {state:'pending',retry_count:0,next_run:new Date(at).toISOString()};
}
