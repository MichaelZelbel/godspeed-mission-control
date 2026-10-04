import {useState} from 'react';
function Review({conflict:c,resolve}:{conflict:any,resolve:(body:any)=>Promise<void>}){
  const [merged,setMerged]=useState(''),[busy,setBusy]=useState(false);
  const choose=async(choice:string)=>{setBusy(true);try{await resolve({id:c.id,choice,expected_hash:c.current_hash,...(choice==='merged'?{text:merged}:{})});}finally{setBusy(false);}};
  const shown=(value:any,binary:boolean)=>binary?'This file is retained for recovery.':typeof value==='string'?value:JSON.stringify(value,null,2);
  return <article className="border p-4 my-3"><h3>{c.path||c.type+'/'+c.record_id}</h3>
    <h4>Current saved version</h4><pre className="whitespace-pre-wrap max-h-64 overflow-auto text-xs">{shown(c.current,c.current_encoding==='base64')}</pre>
    <button disabled={busy||c.current===null} className="border p-2" onClick={()=>choose('current')}>Keep the current saved version</button>
    <p>Both older edits and the version you reviewed remain saved for recovery. If the file changes while you review it, reload before choosing.</p>
    <div className="grid md:grid-cols-2 gap-3">{['local','remote'].map(choice=><div key={choice}><h4>{choice==='local'?'Your pending edit':'The other saved edit'}</h4><pre className="whitespace-pre-wrap max-h-64 overflow-auto text-xs">{shown(c[choice],c.encoding==='base64')}</pre><button disabled={busy||c[choice]===null} className="border p-2" onClick={()=>choose(choice)}>Keep this version</button></div>)}</div>
    {c.encoding!=='base64'&&c.current_encoding!=='base64'&&<details><summary>Combine the edits</summary><label>Merged content<textarea className="block w-full border bg-background p-2" value={merged} onChange={e=>setMerged(e.target.value)}/></label><button disabled={busy||!merged.trim()} className="border p-2" onClick={()=>choose('merged')}>Save the merged edit</button></details>}
  </article>;
}
export function ConflictReview({conflicts,resolve}:{conflicts:any[],resolve:(body:any)=>Promise<void>}){
  return <section><h2 className="text-xl">Review conflicting edits</h2>{conflicts.map(c=><Review key={c.id} conflict={c} resolve={resolve}/>)}</section>;
}
