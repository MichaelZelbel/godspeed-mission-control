import {useEffect,useState} from 'react';
// Settings > Sync and schedule ownership > Private GitHub repository. When this computer is not
// signed in to GitHub yet, the server starts a GitHub sign-in (core/sync/github-sign-in.mjs) and
// this form says what is happening, shows a one-time code when there is one, and follows the
// sign-in until the private repository has been checked again (8 October 2026).
async function call(route:string,body?:any){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
const active=(s:any)=>s&&['signing_in','checking'].includes(s.state);
export function RecordSyncForm({onError,onChange}:{onError:(message:string)=>void;onChange:()=>void}){
  const [remote,setRemote]=useState(''),[signIn,setSignIn]=useState<any>(null),[sending,setSending]=useState(false);
  useEffect(()=>{
    if(!active(signIn))return;
    const timer=setInterval(async()=>{try{const next=(await call('sync/sign-in')).signIn;setSignIn(next);if(!active(next))onChange();}catch{}},2000);
    return ()=>clearInterval(timer);
  },[signIn?.state]);
  const connect=async(e:any)=>{e.preventDefault();setSending(true);setSignIn(null);try{onError('');const r=await call('sync/configure',{url:remote});setSignIn(r.signIn||null);onChange();}catch(error:any){onError(error.message);}finally{setSending(false);}};
  return <form className="space-y-3" onSubmit={connect}>
    <label>Private GitHub repository<input className="block w-full bg-background border p-2" value={remote} onChange={e=>setRemote(e.target.value)} required/></label>
    <p>If this computer is not signed in to GitHub yet, a GitHub sign-in page opens in your browser the first time. Records sync every minute. Keys, media and search databases stay outside Git.</p>
    <button className="border p-2" disabled={sending||active(signIn)}>Connect record sync</button>
    {signIn&&signIn.state!=='idle'&&<div role="status" className="space-y-2">
      <p className={signIn.state==='failed'?'text-red-400':undefined}>{signIn.message}</p>
      {signIn.code&&active(signIn)&&<p className="text-2xl font-mono tracking-widest">{signIn.code}</p>}
      {signIn.url&&active(signIn)&&<a className="underline" href={signIn.url} target="_blank" rel="noreferrer">Open GitHub's sign-in page</a>}
    </div>}
  </form>;
}
