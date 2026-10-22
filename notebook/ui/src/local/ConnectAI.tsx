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
const SERVICES=[
  {id:'openrouter',name:'OpenRouter',url:'https://openrouter.ai/api/v1/chat/completions'},
  {id:'openai',name:'OpenAI',url:'https://api.openai.com/v1/chat/completions'},
  {id:'other',name:'Another service',url:''},
];
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
        <select className="block border bg-background rounded p-2 min-h-11" value={service} onChange={e=>setService(e.target.value)}>{SERVICES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {service==='other'&&<label className="block">Its address, as the service gives it (OpenAI-compatible)
        <Input required type="url" placeholder="https://…/v1" value={address} onChange={e=>setAddress(e.target.value)}/></label>}
      <label className="block">Model, written the way your service writes it
        <Input required spellCheck={false} placeholder={service==='openrouter'?'for example vendor/model-name':''} value={model} onChange={e=>setModel(e.target.value)}/></label>
      <label className="block">Key
        <Input required type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)}/></label>
      {data?.available&&<label className="flex gap-2 items-start"><input type="checkbox" className="mt-1" checked={useForRoutines} onChange={e=>setRoutines(e.target.checked)}/><span>Use it for the daily routines and the chat too{data.source==='hermes'?'. Unticked, they keep the account you signed in to in Hermes.':'.'}</span></label>}
      <Button className="min-h-11" disabled={busy}>{busy?<><Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true"/>Testing…</>:'Test and connect'}</Button>
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
export const BACKUP_GUIDE='https://godspeedmissioncontrol.com/guide/backup-ai';
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
      <p>{status.data?.configured?'Connect another one in its place:':'Connect one with an API key:'}</p>
      <label className="block">Backup AI service
        <select className="block border bg-background rounded p-2 min-h-11" value={service} onChange={e=>setService(e.target.value)}>{SERVICES.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      {service==='other'&&<label className="block">Its address, as the service gives it (OpenAI-compatible)
        <Input required type="url" placeholder="https://…/v1" value={address} onChange={e=>setAddress(e.target.value)}/></label>}
      <label className="block">Backup model, written the way your service writes it
        <Input required spellCheck={false} placeholder={service==='openrouter'?'for example vendor/model-name':''} value={model} onChange={e=>setModel(e.target.value)}/></label>
      <label className="block">Backup key
        <Input required type="password" autoComplete="off" spellCheck={false} value={key} onChange={e=>setKey(e.target.value)}/></label>
      <Button className="min-h-11" disabled={busy}>{busy?<><Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true"/>Testing…</>:'Test and connect as backup'}</Button>
      {done&&<p role="status">{done}</p>}
      {error&&<p role="alert" className="text-red-500">{error}</p>}
    </form>
    <p className="text-muted-foreground">A ChatGPT plan or another sign-in as your backup: see <a className="underline" href={BACKUP_GUIDE} target="_blank" rel="noreferrer">Connect a backup AI</a> in the user guide.</p>
  </div>;
}
