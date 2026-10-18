import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';

// Settings > Notifications, for the notebook on your own computer or server (18 October 2026). Its
// switches came from the hosted notebook (a digest by email, stale action items, contact follow-ups,
// patterns) and nothing here read them, so they sent nothing. Now each one is a message your
// routines really send: the morning brief, a summary at the time you choose, and the weekly review
// on the day you choose. Switching one on makes or resumes its routine; off pauses it.
const DAYS=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
async function call(body?:any){const r=await fetch('/api/notifications',{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
export function Notifications(){
 const qc=useQueryClient(),{data}=useQuery({queryKey:['notifications'],queryFn:()=>call()});
 const [daily,setDaily]=useState<any>(null),[weekly,setWeekly]=useState<any>(null),[error,setError]=useState(''),[saved,setSaved]=useState(''),[saving,setSaving]=useState(false);
 useEffect(()=>{if(data?.available){setDaily(data.daily);setWeekly(data.weekly);}},[data]);
 if(!data)return <p role="status">Loading what Godspeed sends you...</p>;
 if(!data.available)return <p>Your assistant sends the messages of your routines; see Routines below.</p>;
 if(!daily||!weekly)return null;
 const save=async()=>{setSaving(true);setError('');setSaved('');try{const result=await call({daily,weekly});setDaily(result.daily);setWeekly(result.weekly);setSaved('Saved. Your routines follow it.');qc.invalidateQueries();}catch(e:any){setError(e.message);}finally{setSaving(false);}};
 return <section className="space-y-3"><h3 className="text-lg">Notifications</h3>
  <p>{data.delivery==='telegram'?'They come to you in Telegram.':'They are notes in the folder From your routines; with Telegram connected they come there.'} Where they go is set under Routine delivery.</p>
  <label className="flex items-center gap-2"><input type="checkbox" checked={daily.enabled} onChange={e=>setDaily({...daily,enabled:e.target.checked})}/> Morning brief: the one thing that needs you, what changed, your dates and what your watches found</label>
  {daily.enabled&&<label className="block ml-6">Every day at<input type="time" required className="ml-2 border bg-background p-2" value={daily.time} onChange={e=>setDaily({...daily,time:e.target.value})}/></label>}
  <label className="flex items-center gap-2"><input type="checkbox" checked={weekly.enabled} onChange={e=>setWeekly({...weekly,enabled:e.target.checked})}/> Weekly review: your inbox filed, and how each goal is going</label>
  {weekly.enabled&&<div className="ml-6 flex gap-2 flex-wrap"><label>Every<select className="ml-2 border bg-background p-2" value={weekly.day} onChange={e=>setWeekly({...weekly,day:Number(e.target.value)})}>{DAYS.map((d,i)=><option key={d} value={i}>{d}</option>)}</select></label><label>at<input type="time" required className="ml-2 border bg-background p-2" value={weekly.time} onChange={e=>setWeekly({...weekly,time:e.target.value})}/></label></div>}
  <button className="border p-2" disabled={saving} onClick={save}>{saving?'Saving...':'Save notifications'}</button>
  {saved&&<p role="status">{saved}</p>}{error&&<p role="alert" className="text-red-400">{error}</p>}
 </section>;
}
