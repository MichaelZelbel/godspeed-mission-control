import {useState} from 'react';
export function EditGoal({goal,operation}:{goal:any,operation:(input:any)=>Promise<boolean>}){
 const [baseline,setBaseline]=useState<any>(null);
 if(!baseline)return <button className="border rounded p-2" onClick={()=>setBaseline({...goal})}>Change this goal</button>;
 return <form className="border rounded p-3 space-y-2" onSubmit={e=>{
  e.preventDefault();const fields=new FormData(e.currentTarget);
  void operation({type:'goal-change',id:baseline.id,expected:baseline._hash,title:String(fields.get('title')),measure:String(fields.get('measure')),wait_for_report:fields.get('wait-for-report')==='on',reason:String(fields.get('reason'))}).then(saved=>{if(saved)setBaseline(null);});
 }}>
  <label className="block">Changed goal<input name="title" required defaultValue={baseline.title} className="block border bg-background p-2 w-full"/></label>
  <label className="block">Changed progress measure<input name="measure" required defaultValue={baseline.measure||''} className="block border bg-background p-2 w-full"/></label>
  <label className="block"><input name="wait-for-report" type="checkbox" defaultChecked={baseline.wait_for_report===true}/> Wait for my separate report after a verified local change</label>
  <label className="block">Why this direction changed<textarea name="reason" required className="block border bg-background p-2 w-full"/></label>
  <p>Saving cancels unfinished work for the old direction. New work must use the changed goal.</p>
  <button className="border rounded p-2">Save the changed goal</button>
  <button type="button" className="border rounded p-2" onClick={()=>setBaseline(null)}>Close goal editor</button>
 </form>;
}
