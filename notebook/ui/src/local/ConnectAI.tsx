import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {AlertTriangle,CheckCircle2,Loader2} from 'lucide-react';

// Settings > Your AI (18 October 2026). What the person connects here powers the notebook and, unless
// they untick it, the daily routines and the chat too (notebook/core/routine-ai.mjs): every installer
// sends them here, and until this change the routines never got it. The section says plainly whether
// the routines can reach the AI, from one short request through Hermes, the way a routine makes its own.
// backup: present when a backup AI is connected, since the check then asks the main one and the
// backup each on their own (core/routine-ai.mjs).
type Check={at:string;ok:boolean;reply?:string;error?:string;backup?:{ok:boolean;error?:string;model?:string}};
export type RoutineAI={available:boolean;provider?:string|null;model?:string|null;base_url?:string|null;source?:'settings'|'hermes'|'none';key?:boolean|null;check?:Check|null};
async function call(route:string,body?:unknown){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
export const routineAIStatus=()=>call('routine-ai') as Promise<RoutineAI>;
// THE CHOICES, the same for the main AI and the backup (22 October 2026, discussion #20): a key of
// OpenRouter, OpenAI or another OpenAI-compatible service, and, where Hermes runs the routines, a
// ChatGPT plan signed in right here (PlanSignIn, core/plan-signin.mjs), as the one-line server's
// Telegram setup signs it in.
const SERVICES=[
  {id:'openrouter',name:'OpenRouter',url:'https://openrouter.ai/api/v1/chat/completions'},
  {id:'openai',name:'OpenAI',url:'https://api.openai.com/v1/chat/completions'},
  {id:'chatgpt',name:'ChatGPT (sign in with your ChatGPT plan)',url:'',plan:true},
  {id:'other',name:'Another service',url:''},
];
export const servicesFor=(hermes:boolean)=>SERVICES.filter(s=>hermes||!s.plan);
// The AI service in the words a person knows it by.
export function serviceName(provider?:string|null,base?:string|null){
  const known:Record<string,string>={openrouter:'OpenRouter','openai-api':'OpenAI','openai-codex':'your ChatGPT account',nous:'Nous Portal',anthropic:'Anthropic',gemini:'Google Gemini',copilot:'GitHub Copilot'};
  if(provider&&known[provider])return known[provider];
  // 'api': the backup address the Settings form saved for an installation without Hermes.
  if((provider==='custom'||provider==='api')&&base){try{return new URL(base).hostname;}catch{}}
  return provider||'an AI service';
}
const when=(at:string)=>{const d=new Date(at);return isNaN(d.getTime())?at:d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});};
const DAY=24*3600*1000;

export function RoutineAIState({status,checking,onCheck}:{status?:RoutineAI;checking:boolean;onCheck:()=>void}){
  if(!status?.available)return null;
  if(status.source==='none')return <p className="flex gap-2 items-start" role="status"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>Your daily routines have no AI to think with yet, so they cannot run. Connect your AI below.</span></p>;
  const check=status.check;
  return <div className="space-y-2">
    <p>Your routines and the chat use <strong>{status.model}</strong> through {serviceName(status.provider,status.base_url)}{status.source==='hermes'?', the account you signed in to in Hermes':''}.</p>
    {status.key===false&&<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>Its key is missing, so the routines cannot reach it. Connect it again below.</span></p>}
    {checking?<p className="flex gap-2 items-center" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true"/>Asking the AI the way a routine does. This can take a minute.</p>
      :check?.ok?<p className="flex gap-2 items-start" role="status"><CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden="true"/><span>The routines reached it on {when(check.at)}.</span></p>
      :check?<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>The routines could not reach it on {when(check.at)}. {check.error} {check.backup?.ok?'Your backup AI answered instead, so the daily work goes on until the main one is back.':'Until they can, the daily work does not run.'}</span></p>
      :<p className="text-muted-foreground">Not checked yet.</p>}
    {!checking&&check?.backup&&(check.backup.ok
      ?(check.ok&&<p className="flex gap-2 items-start" role="status"><CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" aria-hidden="true"/><span>Your backup AI{check.backup.model?<> (<strong>{check.backup.model}</strong>)</>:null} answered too.</span></p>)
      :<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>Your backup AI{check.backup.model?' ('+check.backup.model+')':''} did not answer{check.ok?'':' either'}. {check.backup.error}</span></p>)}
    <Button type="button" variant="outline" className="min-h-11" disabled={checking} onClick={onCheck}>{checking?'Checking…':'Check now'}</Button>
  </div>;
}

export function ConnectAI(){
  const qc=useQueryClient();
  const status=useQuery({queryKey:['routine-ai'],queryFn:routineAIStatus});
  const [service,setService]=useState('openrouter'),[address,setAddress]=useState(''),[model,setModel]=useState(''),[key,setKey]=useState('');
  const [routines,setRoutines]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const data=status.data,useForRoutines=routines??(data?.source!=='hermes');
  const check=async()=>{setChecking(true);setError('');try{qc.setQueryData(['routine-ai'],await call('routine-ai/check',{}));}catch(e:any){setError(e.message);}finally{setChecking(false);}};
  // An AI nobody checked for a day is checked once when Settings opens, so what it says is seen, not assumed.
  const looked=useRef(false);
  useEffect(()=>{if(looked.current||!data?.available||data.source==='none')return;looked.current=true;if(!data.check||Date.now()-Date.parse(data.check.at)>DAY)check();},[data]);
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setDone('');
    const url=service==='other'?address.trim():SERVICES.find(s=>s.id===service)!.url;
    try{const result=await call('provider',{url,key,model,routines:useForRoutines});setKey('');
      if(result.routines?.available)qc.setQueryData(['routine-ai'],result.routines);
      setDone(!useForRoutines||!result.routines?.available?'Connected. The notebook uses it.':result.routines.check?.ok?'Connected. The routines, the chat and the notebook use it, and the routines reached it just now.':'Connected for the notebook, but the routines could not reach it: '+(result.routines.check?.error||'no answer')+'.');
      qc.invalidateQueries({queryKey:['candidate-status']});
    }catch(err:any){setError(err.message);}finally{setBusy(false);}};
  return <section id="connect-ai" className="border rounded p-4 space-y-4" aria-labelledby="connect-ai-title">
    <h2 id="connect-ai-title" className="text-xl">Your AI</h2>
    {status.isLoading?<p role="status">Reading which AI your routines use…</p>:<RoutineAIState status={data} checking={checking} onCheck={check}/>}
    <form className="space-y-3" onSubmit={submit}>
      <p>Connect the AI account you pay for. The key stays on this device and never goes into your notes.</p>
      <label className="block">Your AI service
        <select className="block border bg-background rounded p-2 min-h-11" value={service} onChange={e=>setService(e.target.value)}>{servicesFor(!!data?.available).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {service==='chatgpt'?<PlanSignIn as="main" onConnected={signedIn=>{setError('');setDone('Connected. Your ChatGPT plan ('+signedIn.model+') now powers the routines, the chat and the notebook.');qc.invalidateQueries({queryKey:['routine-ai']});qc.invalidateQueries({queryKey:['backup-ai']});qc.invalidateQueries({queryKey:['candidate-status']});}}/>:<>
      {service==='other'&&<label className="block">Its address, as the service gives it (OpenAI-compatible)
        <Input required type="url" placeholder="https://…/v1" value={address} onChange={e=>setAddress(e.target.value)}/></label>}
      <label className="block">Model, written the way your service writes it
        <Input required spellCheck={false} placeholder={service==='openrouter'?'for example vendor/model-name':''} value={model} onChange={e=>setModel(e.target.value)}/></label>
      <label className="block">Key
        <Input required type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)}/></label>
      {data?.available&&<label className="flex gap-2 items-start"><input type="checkbox" className="mt-1" checked={useForRoutines} onChange={e=>setRoutines(e.target.checked)}/><span>Use it for the daily routines and the chat too{data.source==='hermes'?'. Unticked, they keep the account you signed in to in Hermes.':'.'}</span></label>}
      <Button className="min-h-11" disabled={busy}>{busy?<><Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true"/>Testing…</>:'Test and connect'}</Button></>}
      {done&&<p role="status">{done}</p>}
      {error&&<p role="alert" className="text-red-500">{error}</p>}
    </form>
    <BackupAI/>
  </section>;
}

// A BACKUP AI (22 October 2026, discussion #20): a second AI the person connects themselves, used
// only when the main one fails and only for that request (core/backup-ai.mjs). Never added by
// Godspeed. Here: what it is, what it did, a form like the one above, and Remove.
export type BackupStatus={hermes?:boolean;configured:boolean;removed?:boolean;more?:number;
  backup:null|{provider:string;model:string;base_url?:string|null;via:'settings'|'telegram'|'hermes';at?:string|null};
  usage?:{answers:number;last_answer_at:string|null;main_failing_since:string|null;last_main_error:string|null}};
const whereFrom={settings:'You connected it here.',telegram:'You connected it in Telegram.',hermes:'It is set in Hermes itself.'};
export function BackupState({status,removing,onRemove}:{status?:BackupStatus;removing:boolean;onRemove:()=>void}){
  if(!status)return null;
  if(!status.configured||!status.backup)return <p>No backup AI is connected.</p>;
  const {backup,usage}=status,answers=usage?.answers||0;
  return <div className="space-y-2">
    <p>Your backup AI is <strong>{backup.model}</strong> through {serviceName(backup.provider,backup.base_url)}. {whereFrom[backup.via]||''}{status.more?' Hermes has '+status.more+' more after it.':''}</p>
    {usage?.main_failing_since&&<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>Your main AI has been failing since {when(usage.main_failing_since)}.{usage.last_main_error?' '+usage.last_main_error:''}</span></p>}
    <p>{answers?<>It answered {answers===1?'once':answers+' times'} while your main AI was failing, the last time on {when(usage!.last_answer_at!)}.</>:'It has not been needed yet.'}</p>
    <Button type="button" variant="outline" className="min-h-11" disabled={removing} onClick={onRemove}>{removing?'Removing…':'Remove the backup'}</Button>
  </div>;
}
export function BackupAI(){
  const qc=useQueryClient();
  const status=useQuery({queryKey:['backup-ai'],queryFn:()=>call('backup-ai') as Promise<BackupStatus>});
  const [service,setService]=useState('openrouter'),[address,setAddress]=useState(''),[model,setModel]=useState(''),[key,setKey]=useState('');
  const [busy,setBusy]=useState(false),[removing,setRemoving]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const submit=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setDone('');
    const url=service==='other'?address.trim():SERVICES.find(s=>s.id===service)!.url;
    try{qc.setQueryData(['backup-ai'],await call('backup-ai',{url,key,model}));setKey('');setModel('');
      setDone('Connected as your backup. It answered a test just now, and it steps in only when your main AI fails.');
      qc.invalidateQueries({queryKey:['routine-ai']});
    }catch(err:any){setError(err.message);}finally{setBusy(false);}};
  const remove=async()=>{setRemoving(true);setError('');setDone('');
    try{qc.setQueryData(['backup-ai'],await call('backup-ai/remove',{}));setDone('The backup is removed. When your main AI fails, the work waits for it again.');qc.invalidateQueries({queryKey:['routine-ai']});}
    catch(err:any){setError(err.message);}finally{setRemoving(false);}};
  return <div className="border-t pt-4 space-y-3" role="group" aria-labelledby="backup-ai-title">
    <h3 id="backup-ai-title" className="text-lg">Backup AI</h3>
    <p>A second AI that steps in only when your main AI fails, for example during an outage or when its usage limit is reached. It answers only that one request; the next one tries your main AI first again. Godspeed never adds one by itself.</p>
    {status.isLoading?<p role="status">Reading your backup AI…</p>:<BackupState status={status.data} removing={removing} onRemove={remove}/>}
    <form className="space-y-3" onSubmit={submit} aria-label="Connect a backup AI">
      <p>{status.data?.configured?'Connect another one in its place, the same ways as your main AI:':'Connect one the same ways as your main AI:'}</p>
      <label className="block">Backup AI service
        <select className="block border bg-background rounded p-2 min-h-11" value={service} onChange={e=>setService(e.target.value)}>{servicesFor(!!status.data?.hermes).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {service==='chatgpt'?<PlanSignIn as="backup" onConnected={signedIn=>{setError('');setDone('Connected as your backup: your ChatGPT plan ('+signedIn.model+'). It answered a test just now, and it steps in only when your main AI fails.');qc.invalidateQueries({queryKey:['backup-ai']});qc.invalidateQueries({queryKey:['routine-ai']});}}/>:<>
      {service==='other'&&<label className="block">Its address, as the service gives it (OpenAI-compatible)
        <Input required type="url" placeholder="https://…/v1" value={address} onChange={e=>setAddress(e.target.value)}/></label>}
      <label className="block">Backup model, written the way your service writes it
        <Input required spellCheck={false} placeholder={service==='openrouter'?'for example vendor/model-name':''} value={model} onChange={e=>setModel(e.target.value)}/></label>
      <label className="block">Backup key
        <Input required type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)}/></label>
      <Button className="min-h-11" disabled={busy}>{busy?<><Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true"/>Testing…</>:'Test and connect as backup'}</Button></>}
      {done&&<p role="status">{done}</p>}
      {error&&<p role="alert" className="text-red-500">{error}</p>}
    </form>
  </div>;
}

// THE CHATGPT PLAN SIGN-IN, one for both forms (core/plan-signin.mjs): Hermes gives an address and a
// code, the person types the code there, and once it went through the plan's first model that answers
// is saved as the main AI or the backup. Nothing is saved that did not answer.
export type SignIn={available?:boolean;state:'idle'|'starting'|'waiting'|'connecting'|'connected'|'failed';as?:'main'|'backup';url?:string;code?:string;error?:string;model?:string};
const ACTIVE=['starting','waiting','connecting'];
export function PlanSignIn({as,onConnected,every=2500}:{as:'main'|'backup';onConnected:(s:SignIn)=>void;every?:number}){
  const [status,setStatus]=useState<SignIn|null>(null),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const mine=status?.as===as?status:null,active=!!mine&&ACTIVE.includes(mine.state);
  // A sign-in already under way (Settings opened again while it waits) is picked up.
  useEffect(()=>{call('ai-signin').then(setStatus).catch(()=>{});},[]);
  useEffect(()=>{if(!active)return;const timer=setInterval(()=>{call('ai-signin').then(setStatus).catch((e:any)=>setError(e.message));},every);return ()=>clearInterval(timer);},[active,every]);
  // Reported once, and only for a sign-in this form saw under way.
  const saw=useRef(false),told=useRef(false);if(active)saw.current=true;
  useEffect(()=>{if(mine?.state==='connected'&&saw.current&&!told.current){told.current=true;onConnected(mine);}},[mine?.state]);
  const start=async()=>{setError('');told.current=false;saw.current=false;try{setStatus(await call('ai-signin/start',{as}));}catch(e:any){setError(e.message);}};
  const cancel=async()=>{setError('');try{setStatus(await call('ai-signin/cancel',{}));}catch(e:any){setError(e.message);}};
  const copy=async()=>{try{await navigator.clipboard.writeText(mine?.code||'');setCopied(true);}catch{}};
  return <div className="space-y-3" role="group" aria-label={as==='backup'?'Sign in with ChatGPT for your backup AI':'Sign in with ChatGPT'}>
    {mine?.state==='starting'?<p className="flex gap-2 items-center" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true"/>Asking ChatGPT for a sign-in code…</p>
    :mine?.state==='waiting'?<div className="space-y-2" role="status">
      <p>Open this page on your phone or computer: <a className="underline" href={mine.url} target="_blank" rel="noreferrer">{mine.url}</a></p>
      <p>Type this code there: <code className="text-lg font-mono">{mine.code}</code> <Button type="button" variant="outline" className="min-h-11 ml-2" onClick={copy}>{copied?'Copied':'Copy code'}</Button></p>
      <p>Sign in with your ChatGPT account. The code lasts 15 minutes, and this page notices as soon as it went through.</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={cancel}>Cancel</Button></div>
    :mine?.state==='connecting'?<p className="flex gap-2 items-center" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true"/>You are signed in to ChatGPT. Finding a model your plan may use; this can take a minute.</p>
    :<>
      <p>{as==='backup'?'Sign in with the ChatGPT account whose plan steps in when your main AI fails.':'Sign in with the ChatGPT account whose plan Godspeed should use.'} Any plan with Codex works; Plus or higher is best for daily use.</p>
      {mine?.state==='failed'&&<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>{mine.error}</span></p>}
      <Button type="button" className="min-h-11" onClick={start}>{mine?.state==='failed'?'Try again':'Sign in with ChatGPT'}</Button></>}
    {error&&<p role="alert" className="text-red-500">{error}</p>}
  </div>;
}
