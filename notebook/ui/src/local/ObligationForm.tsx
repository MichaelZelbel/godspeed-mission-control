import {useState} from 'react';

// Settings > Obligations and reminders. A deadline saved here becomes one of mc-due's reminders,
// the kind the 08:00 deadline reminders and the morning brief read (notebook/core/native-due.mjs):
// a page under Deadlines/ in the notebook, which syncs the way every note does (#90). Until
// 18 October 2026 it stayed a notebook record that nothing reminded about. It asks what mc-due asks
// once: what is true when it is done, and what passing the deadline costs.
export function ObligationForm({operation}:{operation:(input:any)=>Promise<boolean>}){
 const [title,setTitle]=useState(''),[due,setDue]=useState(''),[target,setTarget]=useState(''),[start,setStart]=useState(''),[doneWhen,setDoneWhen]=useState(''),[cost,setCost]=useState(''),[days,setDays]=useState(''),[saved,setSaved]=useState('');
 // A day, sent as its noon in UTC: the same day on every clock from UTC-11 to UTC+11.
 const iso=(value:string)=>value?value+'T12:00:00Z':null;
 return <form className="space-y-2" onSubmit={async e=>{e.preventDefault();setSaved('');const ok=await operation({type:'obligation-add',title,done_when:doneWhen,due_at:iso(due),target_at:iso(target),...(start?{start_at:iso(start)}:{}),...(due?{cost}:{}),recurrence:days?{days:Number(days)}:null});if(ok){setSaved('Saved. Your deadline reminders mention it when it is time.');setTitle('');setDue('');setTarget('');setStart('');setDoneWhen('');setCost('');setDays('');}}}>
  <label className="block">What needs doing?<input className="block border bg-background p-2 w-full" value={title} onChange={e=>setTitle(e.target.value)} required/></label>
  <label className="block">What is true when it is done?<input className="block border bg-background p-2 w-full" value={doneWhen} onChange={e=>setDoneWhen(e.target.value)} required/></label>
  <label className="block">Deadline, the last day before it costs you<input type="date" className="block border bg-background p-2" value={due} onInput={e=>setDue(e.currentTarget.value)} onChange={e=>setDue(e.target.value)}/></label>
  {due&&<label className="block">What does it cost you if that day passes?<input className="block border bg-background p-2 w-full" value={cost} onChange={e=>setCost(e.target.value)} required/></label>}
  <label className="block">A day you would like it done by, if there is one<input type="date" className="block border bg-background p-2" value={target} onInput={e=>setTarget(e.currentTarget.value)} onChange={e=>setTarget(e.target.value)}/></label>
  <label className="block">The day you can start, if not today<input type="date" className="block border bg-background p-2" value={start} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></label>
  <label className="block">Repeat after how many days? Leave empty for once.<input type="number" min="1" max="366" className="block border bg-background p-2" value={days} onChange={e=>setDays(e.target.value)}/></label>
  <button className="border p-2">Remember this obligation</button>{saved&&<p role="status">{saved}</p>}
 </form>;
}
