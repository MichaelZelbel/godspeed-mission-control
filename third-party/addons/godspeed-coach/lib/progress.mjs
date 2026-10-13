// Derived only from the habit file. Reading progress never manufactures a day answer or spends
// persistent tokens. Corrections therefore refund protection and recompute every total naturally.
import {addDays,daysBetween,weekdayOf,localParts,zonedToUtc,now as clockNow} from './clock.mjs';

export function validDay(value) {
  return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
}
export function assertDay(value) { if(!validDay(value))throw Error('Choose a real calendar date written YYYY-MM-DD'); return value; }
export function stateOn(habit,date) {
  const history=(habit.progressHistory||[]).filter(e=>e.on<=date).sort((a,b)=>a.on.localeCompare(b.on));
  const schedule=history.filter(e=>e.kind==='schedule').at(-1);
  const status=history.filter(e=>e.kind==='status').at(-1);
  // Legacy schedules cannot be reconstructed. Their coverage is disclosed by habitProgress.
  const days=schedule?.days||habit.days;
  const state=status?.status || (habit.progressHistory?.some(e=>e.kind==='status')?'active':habit.status);
  return {days,status:state,scheduled:(!habit.started||date>=habit.started)&&(days==='daily'||days?.includes(weekdayOf(date))),known:!!schedule};
}
const milestoneDays=total=>[1,10,25,50,100,...Array.from({length:Math.floor(Math.max(0,total-100)/25)+1},(_,i)=>125+i*25)];

export function habitProgress(habit,{now=clockNow(),timezone='UTC',calendarDays=14}={}) {
  const zone=habit.timezone||timezone,today=localParts(now,zone).date;
  if(!Number.isInteger(calendarDays)||calendarDays<1||calendarDays>366)throw Error('Choose calendarDays from 1 to 366');
  const completed=Object.keys(habit.log||{}).filter(d=>validDay(d)&&d<=today&&habit.log[d].answer==='done').sort();
  const events=habit.progressHistory||[],scheduleStart=events.filter(e=>e.kind==='schedule').map(e=>e.on).sort()[0];
  const historyComplete=!!scheduleStart&&(!habit.started||scheduleStart<=habit.started);
  const firstRecord=Object.keys(habit.log||{}).filter(validDay).sort()[0];
  // Do not invent a historical schedule for old files. Start a verified run from the first
  // effective schedule, while lifetime actual completions still include all older records.
  const from=historyComplete?(habit.started||scheduleStart):scheduleStart||today;
  const start=[from,addDays(today,-(calendarDays-1))].sort()[0];
  if(!validDay(start)||daysBetween(start,today)>36600)throw Error('Habit progress supports at most one hundred years of dated history');
  const calendar=[],protections=[],runs=[];let run=0,longest=0,lastBreak=null;
  const note=historyComplete?null:'Lifetime totals include all recorded completions. Streak history starts when a dated schedule is available.';
  for(let date=start;date<=today;date=addDays(date,1)) {
    const state=stateOn(habit,date),rawAnswer=habit.log?.[date]?.answer,answer=['done','no','skip'].includes(rawAnswer)?rawAnswer:null;
    const exemption=events.filter(e=>e.kind==='exempt'&&e.from<=date&&e.to>=date).at(-1);
    let status,reason;
    const inCoverage=date>=from;
    if(answer==='done')status='completed';
    else if(answer==='skip'||exemption||state.status!=='active') {status='paused';reason=exemption?.reason|| (answer==='skip'?'Does not count':state.status);}
    else if(!state.scheduled)status='notplanned';
    else if(!inCoverage) {status='unknown';reason='Historical schedule unavailable';}
    else {
      // Reconciliation lasts 48 real hours after the scheduled local day ends, including DST.
      const deadline=zonedToUtc(addDays(date,1),'00:00',zone).getTime()+48*3600000;
      if(!answer&&now.getTime()<deadline)status='unknown';
      else if(run>0&&protections.filter(d=>daysBetween(d,date)<30).length<2) {status='protected';protections.push(date);}
      else status='missed';
    }
    if(inCoverage) {
      if(status==='completed'&&state.scheduled) {run++;longest=Math.max(longest,run);}
      else if(status==='missed') {if(run)runs.push(run);run=0;lastBreak=date;}
    }
    if(date>=addDays(today,-(calendarDays-1)))calendar.push({date,weekday:weekdayOf(date).replace(/^./,c=>c.toUpperCase()),day:Number(date.slice(-2)),status,answer,scheduled:state.scheduled,...(reason?{reason}:{})});
  }
  const thresholds=milestoneDays(completed.length),earned=thresholds.filter(n=>n<=completed.length);
  const achievements=earned.map(n=>({id:'completed-'+n,days:n,earnedOn:completed[n-1]}));
  const graduation=events.filter(e=>e.kind==='status'&&e.status==='graduated'&&e.on<=today).sort((a,b)=>a.on.localeCompare(b.on))[0];
  if(graduation||habit.status==='graduated')achievements.push({id:'graduated',days:completed.length,earnedOn:graduation?.on||null});
  const next=thresholds.find(n=>n>completed.length)||Math.ceil((completed.length+1)/25)*25;
  const usedDates=protections.filter(d=>daysBetween(d,today)<30);
  const pendingDays=calendar.filter(d=>d.date>=from&&d.status==='unknown'&&d.scheduled).length;
  return {version:1,today,timezone:zone,dayBoundary:'midnight',display:habit.progressDisplay||'standard',currentRun:run,longestRun:longest,lifetimeCompletedDays:completed.length,achievements,nextMilestone:{days:next,remaining:next-completed.length},protections:{limit:2,windowDays:30,used:usedDates.length,remaining:2-usedDates.length,dates:usedDates},coverage:{from,scheduleHistoryComplete:historyComplete,note,firstRecordedDay:firstRecord||null},calendar,lastBreak,pendingDays};
}
