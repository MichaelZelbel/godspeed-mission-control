import {useState} from 'react';

export function ImportHealth({operation}:{operation:(input:any)=>Promise<boolean>}){
 const [source,setSource]=useState(''),[content,setContent]=useState(''),[saving,setSaving]=useState(false),[saved,setSaved]=useState(false);
 async function submit(){
  setSaving(true);setSaved(false);
  try{setSaved(await operation({type:'health-import-csv',source,content}));}finally{setSaving(false);}
 }
 return <details className="border rounded p-4"><summary>Import selected health measurements</summary>
  <p>Choose a CSV or paste the measurements you want Godspeed to use. Include a date column with actual YYYY-MM-DD dates and numeric measurement columns. The original source and corrections are retained.</p>
  <input aria-label="Health measurements CSV" type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(file){setSource(file.name);setContent(await file.text());setSaved(false);}}}/>
  <form className="space-y-2" onSubmit={e=>{e.preventDefault();void submit();}}>
   <label className="block">Measurement source name<input required className="block border bg-background p-2" value={source} onChange={e=>{setSource(e.target.value);setSaved(false);}}/></label>
   <label className="block">Selected measurements CSV<textarea required className="block border bg-background p-2 w-full" value={content} onChange={e=>{setContent(e.target.value);setSaved(false);}}/></label>
   <button className="border p-2" disabled={saving}>{saving?'Saving selected measurements...':'Use these selected measurements'}</button>
   {saved&&<p role="status">Selected measurements saved. Coaching and briefing use fresh measurements only.</p>}
  </form>
 </details>;
}
