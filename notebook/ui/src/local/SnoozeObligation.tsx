import {useState} from 'react';
import {parseInstant,showDate} from '@/lib/local-date';

export function SnoozeObligation({obligation,operation}:{obligation:any;operation:(input:any)=>Promise<boolean>}){
 const [until,setUntil]=useState(''),[saving,setSaving]=useState(false);
 const valid=!!until&&parseInstant(until)!==null;
 async function save(){
  if(!valid||saving)return;
  setSaving(true);
  try{await operation({type:'obligation-snooze',id:obligation.id,until:parseInstant(until)!.toISOString(),expected:obligation._hash});}finally{setSaving(false);}
 }
 return <div>
  <label className="block">Pause reminders until<input type="datetime-local" className="border bg-background p-2" value={until} onInput={e=>setUntil(e.currentTarget.value)} onChange={e=>setUntil(e.target.value)}/></label>
  <button type="button" className="border p-2" disabled={!valid||saving} onClick={save}>{saving?'Saving reminder pause...':'Use this reminder pause'}</button>
  {obligation.snoozed_until&&<p>Reminders paused until {showDate(obligation.snoozed_until,'time')}.</p>}
 </div>;
}
