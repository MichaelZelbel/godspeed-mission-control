import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {AlertTriangle,CheckCircle2,Loader2} from 'lucide-react';

// Settings > Your AI (18 October 2026). What the person connects here powers the notebook and, unless
// they untick it, the daily routines and the chat too (notebook/core/routine-ai.mjs): every installer
// sends them here, and until this change the routines never got it. The section says plainly whether
// the routines can reach the AI, from one short request through Hermes, the way a routine makes its own.
type Check={at:string;ok:boolean;reply?:string;error?:string};
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
  if(provider==='custom'&&base){try{return new URL(base).hostname;}catch{}}
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
      :check?<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>The routines could not reach it on {when(check.at)}. {check.error} Until they can, the daily work does not run.</span></p>
      :<p className="text-muted-foreground">Not checked yet.</p>}
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
  </section>;
}
