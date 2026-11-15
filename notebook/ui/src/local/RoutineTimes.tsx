import {routineRow} from './routine-row.mjs';

// Settings > Routine times. With the original assistant every routine is a Hermes job, and until
// 18 October 2026 every time sent from here was refused for them. Now a routine that runs at a time
// of day shows that time and can be given another (several times share their minutes, "10:00, 16:00");
// the weekly check-in moves its talk; a routine that only looks every few minutes says so instead of
// offering a time it does not have.
const days=(list?:number[])=>(list&&list.length?list:[0,1,2,3,4,5,6]).join(',');
const numbers=(text:string)=>text.split(',').map(s=>s.trim()).filter(Boolean).map(Number);
export function RoutineTimes({jobs,operation}:{jobs:any[],operation:(input:any)=>Promise<boolean>}){
 const hermes=jobs.some(j=>j.native);
 const send=(j:any,form:FormData,times:string[])=>{const monthDay=String(form.get('month-day')||'').trim();return operation({type:'routine-change',id:j.id,calendar:{times,weekdays:numbers(String(form.get('days')||'')),...(monthDay?{month_day:Number(monthDay)}:{})}});};
 const dayFields=(j:any)=><><label className="block">Days, Sunday 0 through Saturday 6<input required name="days" defaultValue={days(j.calendar?.weekdays)} className="border bg-background p-2"/></label><label className="block">Or one day of the month (keep every day above)<input name="month-day" type="number" min="1" max={j.talk?28:31} defaultValue={j.calendar?.month_day||''} className="border bg-background p-2"/></label></>;
 return <details className="border rounded p-4"><summary>Routine times</summary><p>Times are on your own clock, the time zone your mission control uses.</p>
  {jobs.map((j:any)=>{
   const row=routineRow(j);
   if(j.native&&j.calendar&&j.talk)return <form key={j.id} className="border-t py-3 space-y-1" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);send(j,form,[String(form.get('time'))]);}}><p className="font-medium">{row.name}</p><p className="text-sm">{row.when}</p><label>Time<input required name="time" type="time" defaultValue={j.calendar.times[0]} className="border bg-background p-2"/></label>{dayFields(j)}<button className="border p-2">Move the talk</button></form>;
   if(j.native&&j.calendar)return <form key={j.id} className="border-t py-3 space-y-1" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);send(j,form,String(form.get('times')||'').split(',').map(t=>t.trim()).filter(Boolean));}}><p className="font-medium">{row.name}</p><p className="text-sm">{[row.when,row.next].filter(Boolean).join(' ')}</p><label className="block">Times of day, like 07:30 or 10:00, 16:00<input required name="times" defaultValue={j.calendar.times.join(', ')} className="border bg-background p-2"/></label>{dayFields(j)}<button className="border p-2">Use these times</button></form>;
   if(hermes)return <div key={j.id} className="border-t py-3"><p className="font-medium">{row.name}</p><p className="text-sm">{[row.when,'It has no time of day to change.'].filter(Boolean).join(' ')}</p></div>;
   return <form key={j.id} className="border-t py-3" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);const monthDay=String(form.get('month-day')||'').trim();operation({type:'routine-change',id:j.id,calendar:{time:String(form.get('time')),weekdays:numbers(String(form.get('days'))),...(monthDay?{month_day:Number(monthDay)}:{})}});}}><p>{j.kind}: next {new Date(j.next_run).toLocaleString()}</p><label>Time<input required name="time" type="time" defaultValue={j.calendar?.time||'09:00'} className="border bg-background p-2"/></label><label className="block">Weekdays, Sunday 0 through Saturday 6<input required name="days" defaultValue={days(j.calendar?.weekdays)} className="border bg-background p-2"/></label><label className="block">Optional day of the month. Leave empty for a weekly schedule; use every weekday for monthly.<input name="month-day" type="number" min="1" max="31" defaultValue={j.calendar?.month_day||""} className="border bg-background p-2"/></label><button className="border p-2">Use this calendar time</button></form>;
  })}
 </details>;
}
