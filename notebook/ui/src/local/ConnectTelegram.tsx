import {useEffect, useMemo, useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {renderSVG} from 'uqr';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {CheckCircle2, ExternalLink, MessageCircle} from 'lucide-react';

// Telegram on the one-click server: right after the account is made (/dashboard/telegram?welcome=1)
// and in Settings. The key goes to this server only (notebook/server/telegram-connect.mjs); the
// bot's link carries a one-time code, so whoever opens it from this page becomes its owner.
type Status={available:boolean;managed:'web'|'environment'|null;connected:boolean;phase:'none'|'waiting'|'setting-up'|'ready'|'refused';bot?:{username:string;name:string};link?:string;owner?:string|null};
async function call(route:string,body?:unknown){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
export const telegramStatus=()=>call('telegram') as Promise<Status>;
function safeNext(value:string|null){
  if(!value||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value)||/^\/(setup|login|api)(\/|$)/.test(value))return '/dashboard';
  return value;
}

export function TelegramConnect({welcome=false,onContinue}:{welcome?:boolean;onContinue?:()=>void}){
  const qc=useQueryClient();
  const status=useQuery({queryKey:['telegram-status'],queryFn:telegramStatus,refetchInterval:q=>['waiting','setting-up'].includes(q.state.data?.phase||'')?3000:false});
  const [key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[replacing,setReplacing]=useState(false),[leaving,setLeaving]=useState(false);
  const data=status.data,username=data?.bot?.username;
  const qr=useMemo(()=>data?.link?renderSVG(data.link,{border:2,pixelSize:6}):'',[data?.link]);
  const update=(next:Status)=>{qc.setQueryData(['telegram-status'],next);setReplacing(false);setLeaving(false);};
  const connect=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{update(await call('telegram/connect',{token:key}));setKey('');}catch(err:any){setError(err.message);}finally{setBusy(false);}};
  const disconnect=async()=>{setBusy(true);setError('');try{update(await call('telegram/disconnect',{}));}catch(err:any){setError(err.message);}finally{setBusy(false);}};
  if(status.isLoading)return <p role="status">Checking Telegram…</p>;
  if(status.isError)return <p role="alert">Telegram's status could not be read. <button className="underline" onClick={()=>status.refetch()}>Try again</button></p>;
  if(data?.managed==='environment')return <p>Telegram is set up by this server's own settings.</p>;
  if(!data?.available)return null;
  const continueButton=welcome&&onContinue&&<Button variant={data.phase==='none'||data.phase==='refused'?'ghost':'default'} className="min-h-11" onClick={onContinue}>{data.phase==='none'||data.phase==='refused'?'Skip for now':'Continue to your notebook'}</Button>;
  const form=<form className="space-y-3" onSubmit={connect}>
    <ol className="list-decimal pl-5 space-y-2">
      <li>In Telegram, open <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">BotFather</a> and send <code>/newbot</code>. Choose a name, then a username that ends in <code>bot</code>.</li>
      <li>BotFather answers with your bot's key, a long line like <code>123456789:AAH4kq…</code>. Paste it here. It stays on your server.</li>
    </ol>
    <label className="block font-medium" htmlFor="telegram-key">Your bot's key</label>
    <Input id="telegram-key" type="password" autoComplete="off" spellCheck={false} required value={key} onChange={e=>setKey(e.target.value)}/>
    <div className="flex flex-wrap gap-3 items-center"><Button className="min-h-11" disabled={busy||!key.trim()}>{busy?'Checking with Telegram…':'Check and connect'}</Button>{replacing&&<Button type="button" variant="ghost" className="min-h-11" onClick={()=>setReplacing(false)}>Cancel</Button>}{continueButton}</div>
    {welcome&&<p className="text-sm text-muted-foreground">You can also connect Telegram later, in Settings.</p>}
  </form>;
  let body;
  if(data.phase==='none'||replacing)body=form;
  else if(data.phase==='refused')body=<><p role="alert">Telegram no longer accepts the key of @{username}. In BotFather, send <code>/token</code> to see its current key, and paste that here.</p>{form}</>;
  else if(data.phase==='waiting')body=<div className="space-y-4">
    <p>Your bot is <strong>@{username}</strong>. Now open it and press <strong>Start</strong>.</p>
    <Button asChild className="min-h-11 gap-2"><a href={data.link} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" aria-hidden="true"/>Open @{username} in Telegram<ExternalLink className="h-4 w-4" aria-hidden="true"/></a></Button>
    <div className="flex flex-wrap items-center gap-4"><div className="w-40 h-40 bg-white rounded p-1 [&>svg]:w-full [&>svg]:h-full" role="img" aria-label={'QR code that opens @'+username+' in Telegram'} dangerouslySetInnerHTML={{__html:qr}}/><p className="max-w-xs text-sm">Telegram is on your phone? Point its camera at this code.</p></div>
    <p className="text-sm">This link works once, and makes you the bot's owner. Then setup carries on in the chat: it asks which AI to use, connects GitHub, and asks for your city, your briefing and your goal.</p>
    <div className="flex flex-wrap gap-3"><Button variant="ghost" className="min-h-11" onClick={()=>setReplacing(true)}>Use a different bot</Button>{continueButton}</div>
  </div>;
  else if(data.phase==='setting-up')body=<div className="space-y-4" role="status">
    <p>{data.owner?data.owner+', setup':'Setup'} is running in your chat with <strong>@{username}</strong>. Answer its questions there; this page follows along.</p>
    {continueButton}
  </div>;
  else body=<div className="space-y-4">
    <p className="flex items-center gap-2" role="status"><CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true"/>Telegram is connected. Write to <a className="underline" href={'https://t.me/'+username} target="_blank" rel="noopener noreferrer">@{username}</a> from any phone or computer, and your mission control writes to you there.</p>
    {welcome?continueButton:leaving?<div className="flex flex-wrap gap-3 items-center"><span>Your mission control stops answering in Telegram. Disconnect?</span><Button variant="destructive" className="min-h-11" disabled={busy} onClick={disconnect}>Disconnect</Button><Button variant="ghost" className="min-h-11" onClick={()=>setLeaving(false)}>Keep it</Button></div>:<div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" onClick={()=>setReplacing(true)}>Use a different bot</Button><Button variant="ghost" className="min-h-11" onClick={()=>setLeaving(true)}>Disconnect Telegram</Button></div>}
  </div>;
  return <div className="space-y-4">
    <p>Telegram lets you talk to your mission control from any phone or computer. It can also message you there, for example with a reminder.</p>
    <p role="alert" className="text-red-400" hidden={!error}>{error}</p>
    {body}
  </div>;
}

export default function ConnectTelegram(){
  const [params]=useSearchParams(),navigate=useNavigate();
  const welcome=params.get('welcome')==='1',next=safeNext(params.get('next'));
  const status=useQuery({queryKey:['telegram-status'],queryFn:telegramStatus});
  const leave=()=>navigate(next,{replace:true});
  // A server that does not connect Telegram here has no step to show: straight on.
  useEffect(()=>{if(welcome&&status.data&&!status.data.available)leave();},[welcome,status.data]);
  return <div className="max-w-2xl mx-auto">
    <Card><CardHeader><CardTitle className="text-2xl">Connect Telegram</CardTitle></CardHeader>
      <CardContent><TelegramConnect welcome={welcome} onContinue={leave}/></CardContent></Card>
  </div>;
}
