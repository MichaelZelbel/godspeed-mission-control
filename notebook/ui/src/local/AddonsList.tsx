import {useEffect,useState} from 'react';
// Settings > Add-ons: the add-ons Godspeed ships a list of (third-party/addons/catalog.json), each
// with one line on what it does, whether it is added, and the Add and Remove buttons, which is the same path
// as asking the assistant (core/addons-install.mjs). A private add-on's GitHub sign-in is followed
// here as a link and a short code; nothing else is asked.
async function call(route:string,body?:any){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
const active=(s:any)=>s&&['signing_in','checking'].includes(s.state);
export function AddonsList({onError}:{onError:(message:string)=>void}){
  const [addons,setAddons]=useState<any[]>([]),[signIn,setSignIn]=useState<any>(null),[working,setWorking]=useState(''),[said,setSaid]=useState(''),[asking,setAsking]=useState('');
  const load=async()=>{try{setAddons((await call('addons')).addons||[]);}catch(error:any){onError(error.message);}};
  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    if(!active(signIn))return;
    const timer=setInterval(async()=>{try{const next=(await call('sync/sign-in')).signIn;setSignIn(next);if(!active(next)){setSaid(next.state==='failed'?next.message:'');await load();}}catch(error:any){onError(error.message);setSignIn(null);}},2000);
    return ()=>clearInterval(timer);
  },[signIn?.state]);
  const add=async(id:string)=>{setWorking(id);setSaid('');setSignIn(null);try{onError('');const r=await call('addons/add',{addon:id});if(r.state==='signing_in')setSignIn(r.signIn);else setSaid(r.message);await load();}catch(error:any){onError(error.message);}finally{setWorking('');}};
  const remove=async(id:string,data:'keep'|'delete')=>{setAsking('');setWorking(id);setSaid('');try{onError('');const r=await call('addons/remove',{addon:id,data});setSaid(r.message);await load();}catch(error:any){onError(error.message);}finally{setWorking('');}};
  return <section id="add-ons" className="border rounded p-4 space-y-3"><h2 className="text-xl">Add-ons</h2>
    <ul className="space-y-2">{addons.map(a=><li key={a.id} className="flex items-center gap-3 flex-wrap"><span><strong>{a.name}</strong>: {a.description} <em>{a.added?'Added':'Not added'}</em>{a.page&&<> <a className="underline" href={a.page.path} target="_blank" rel="noreferrer">{a.page.title}</a></>}{!a.added&&a.message&&<> {a.message}</>}</span><button className="border p-2" disabled={Boolean(working)||active(signIn)||a.busy} onClick={()=>add(a.id)}>{a.added?'Update':'Add'}<span className="sr-only"> {a.name}</span></button>
      {a.removable&&a.installed&&(asking===a.id
        ?<span role="group" aria-label={'Remove '+a.name} className="flex gap-2 items-center"><span>Keep what {a.name} made, or delete it too?</span>
          <button className="border p-2" autoFocus onClick={()=>remove(a.id,'keep')}>Keep what it made</button>
          <button className="border p-2" onClick={()=>remove(a.id,'delete')}>Delete it too</button>
          <button className="border p-2" onClick={()=>setAsking('')}>Cancel</button></span>
        :<button className="border p-2" disabled={Boolean(working)||active(signIn)||a.busy} onClick={()=>setAsking(a.id)}>Remove<span className="sr-only"> {a.name}</span></button>)}</li>)}</ul>
    {said&&<p role="status">{said}</p>}
    {signIn&&signIn.state!=='idle'&&<div role="status" className="space-y-2"><p>{signIn.message}</p>
      {signIn.code&&active(signIn)&&<p className="text-2xl font-mono tracking-widest">{signIn.code}</p>}
      {signIn.url&&active(signIn)&&<a className="underline" href={signIn.url} target="_blank" rel="noreferrer">Open GitHub's sign-in page</a>}</div>}
  </section>;
}
