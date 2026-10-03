export function ReportedCheck({work,operation}:{work:any,operation:(input:any)=>Promise<void>}){
 if(work.kind!=='observation'||work.state!=='awaiting_approval')return null;
 return <form className="space-y-2" onSubmit={e=>{
  e.preventDefault();const fields=new FormData(e.currentTarget),measurement=String(fields.get('measurement')||'').trim();
  void operation({type:'work-record-observation',id:work.id,expected:work._hash,evidence:String(fields.get('evidence')),passed:fields.get('passed')==='yes',...(measurement?{value:Number(measurement)}:{})});
 }}>
  <p>This check needs your actual observation. A saved draft alone does not establish the result.</p>
  <label className="block">Did the agreed check pass?<select name="passed" required className="block border bg-background p-2" defaultValue=""><option value="" disabled>Choose the actual result</option><option value="yes">Passed</option><option value="no">Failed</option></select></label>
  <label className="block">Optional measured value<input name="measurement" type="number" step="any" className="block border bg-background p-2"/></label>
  <label className="block">Evidence from this check<textarea name="evidence" required className="block border bg-background rounded p-2 w-full"/></label>
  <button className="border p-2">Save the reported check</button>
 </form>;
}
