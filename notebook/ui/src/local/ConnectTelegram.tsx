import {useEffect, useMemo, useState} from 'react';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {renderSVG} from 'uqr';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Check, CheckCircle2, Copy, ExternalLink, MessageCircle} from 'lucide-react';
import {knownTelegramPhase, telegramPollingPhases} from '../../../shared/telegram-status.mjs';

// Telegram on the one-click server: right after the account is made (/dashboard/telegram?welcome=1)
// and in Settings. The key goes to this server only (notebook/server/telegram-connect.mjs); the
// bot's link carries a one-time code, so whoever opens it from this page becomes its owner.
type Status={available:boolean;managed:'web'|'environment'|null;connected:boolean;phase:unknown;bot?:{username:string;name:string};link?:string;start_message?:string;owner?:string|null};
function record(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function stringOrNull(value:unknown):string|null|undefined{if(typeof value==='string')return value;if(value===null)return null;}
async function call(route:string,body?:unknown):Promise<unknown>{const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data:unknown=await r.json(),message=record(data)&&typeof data.error==='string'?data.error:'Telegram did not answer as expected.';if(!r.ok)throw new Error(message);return data;}
function status(value:unknown):Status{
  const data=record(value)?value:null,bot=data&&record(data.bot)?data.bot:null;
  const owner=stringOrNull(data?.owner);
  if(!data||typeof data.available!=='boolean'||typeof data.connected!=='boolean')throw new Error('Telegram returned an invalid status.');
  const result:Status={available:data.available,managed:data.managed==='web'||data.managed==='environment'?data.managed:null,connected:data.connected,phase:data.phase,
    ...(bot&&typeof bot.username==='string'&&typeof bot.name==='string'?{bot:{username:bot.username,name:bot.name}}:{}),
    ...(typeof data.link==='string'?{link:data.link}:{}),...(typeof data.start_message==='string'?{start_message:data.start_message}:{}),};
  if(typeof owner==='string'||owner===null)result.owner=owner;
  return result;
}
export const telegramStatus=async()=>status(await call('telegram'));
// What the browser knows that the setup chat cannot (16 October 2026): its own time zone, which the
// chat offers as the city button, and the address this page was opened at, which the chat's last
// message names when the server does not know its own.
export function browserFacts(){let timezone='';try{timezone=Intl.DateTimeFormat().resolvedOptions().timeZone||'';}catch{}return {timezone,address:window.location.origin};}
// "/start <code>" to send by hand: a bot its owner has chatted with before shows no Start button.
function StartMessage({text}:{text:string}){
  const [copied,setCopied]=useState(false);
  const copy=async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{const range=document.createRange(),box=document.getElementById('telegram-start-message');if(box){range.selectNodeContents(box);const sel=window.getSelection();sel?.removeAllRanges();sel?.addRange(range);}}};
  return <div className="flex flex-wrap items-center gap-2">
    <code id="telegram-start-message" className="min-w-0 max-w-full break-all rounded border bg-muted px-3 py-2 text-sm select-all">{text}</code>
    <Button type="button" variant="outline" className="min-h-11 gap-2" onClick={copy}>{copied?<Check className="h-4 w-4" aria-hidden="true"/>:<Copy className="h-4 w-4" aria-hidden="true"/>}{copied?'Copied':'Copy'}</Button>
    <span className="sr-only" role="status">{copied?'Copied':''}</span>
  </div>;
}
function safeNext(value:string|null){
  if(!value||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]/.test(value)||/^\/(setup|login|api)(\/|$)/.test(value))return '/dashboard';
  return value;
}

export function TelegramConnect({welcome=false,onContinue}:{welcome?:boolean;onContinue?:()=>void}){
  const qc=useQueryClient();
  const query=useQuery({queryKey:['telegram-status'],queryFn:telegramStatus,refetchInterval:q=>{const value=q.state.data?.phase,phase=knownTelegramPhase(value)?String(value):'';return telegramPollingPhases.includes(phase)?3000:false;}});
  const [key,setKey]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[replacing,setReplacing]=useState(false),[leaving,setLeaving]=useState(false);
  const data=query.data,phase=knownTelegramPhase(data?.phase)?String(data.phase):null,username=data?.bot?.username;
  const qr=useMemo(()=>data?.link?renderSVG(data.link,{border:2,pixelSize:6}):'',[data?.link]);
  const update=(next:Status)=>{qc.setQueryData(['telegram-status'],next);setReplacing(false);setLeaving(false);};
  const connect=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{update(status(await call('telegram/connect',{token:key,...browserFacts()})));setKey('');}catch(err:any){setError(err.message);}finally{setBusy(false);}};
  const disconnect=async()=>{setBusy(true);setError('');try{update(status(await call('telegram/disconnect',{})));}catch(err:any){setError(err.message);}finally{setBusy(false);}};
  if(query.isLoading)return <p role="status">Checking Telegram…</p>;
  if(query.isError)return <p role="alert">Telegram's status could not be read. <button className="underline" onClick={()=>query.refetch()}>Try again</button></p>;
  if(data?.managed==='environment')return <p>Telegram is set up by this server's own settings.</p>;
  if(!data?.available)return null;
  const continueButton=welcome&&onContinue&&<Button variant={phase==='none'||phase==='refused'?'ghost':'default'} className="min-h-11" onClick={onContinue}>{phase==='none'||phase==='refused'?'Skip for now':'Continue to your notebook'}</Button>;
  const form=<form className="space-y-3" onSubmit={connect}>
    <ol className="list-decimal pl-5 space-y-2">
      <li>In Telegram, open <a className="underline" href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer">BotFather</a> and send <code>/newbot</code>. Choose a name, then a username that ends in <code>bot</code>.</li>
      <li>BotFather answers with your bot's key, a long line such as <code>123456789:AAH4kq…</code> Paste it here. It stays on your server.</li>
    </ol>
    <label className="block font-medium" htmlFor="telegram-key">Your bot's key</label>
    <Input id="telegram-key" type="password" autoComplete="off" spellCheck={false} required value={key} onChange={e=>setKey(e.target.value)}/>
    <div className="flex flex-wrap gap-3 items-center"><Button className="min-h-11" disabled={busy||!key.trim()}>{busy?'Checking with Telegram…':'Check and connect'}</Button>{replacing&&<Button type="button" variant="ghost" className="min-h-11" onClick={()=>setReplacing(false)}>Cancel</Button>}{continueButton}</div>
    {welcome&&<p className="text-sm text-muted-foreground">You can also connect Telegram later, in Settings.</p>}
  </form>;
  let body;
  if(phase==='none'||replacing)body=form;
  else if(phase==='refused')body=<><p role="alert">Telegram no longer accepts the key of @{username}. In BotFather, send <code>/token</code> to see its current key, and paste that here.</p>{form}</>;
  else if(phase==='gateway-route-failed')body=<p role="alert">Telegram cannot start because this server cannot apply its Telegram API address. Ask the person who runs this server to use an HTTPS address or a loopback HTTP address for <code>GODSPEED_TELEGRAM_API</code>, then this page will reconnect.</p>;
  else if(phase==='waiting')body=<div className="space-y-4">
    <p>Your bot is <strong>@{username}</strong>. Open it in Telegram with the button below and press <strong>Start</strong> at the bottom of the chat.</p>
    <Button asChild className="min-h-11 h-auto max-w-full whitespace-normal py-2 gap-2"><a href={data.link} target="_blank" rel="noopener noreferrer"><MessageCircle className="h-4 w-4" aria-hidden="true"/>Open @{username} in Telegram<ExternalLink className="h-4 w-4" aria-hidden="true"/></a></Button>
    <div className="flex flex-wrap items-center gap-4"><div className="w-40 h-40 bg-white rounded p-1 [&>svg]:w-full [&>svg]:h-full" role="img" aria-label={'QR code that opens @'+username+' in Telegram'} dangerouslySetInnerHTML={{__html:qr}}/><p className="max-w-xs text-sm">Telegram is on your phone? Point its camera at this code.</p></div>
    {data.start_message&&<div className="space-y-2"><p className="text-sm">Used this bot before and see no Start button? Then send it this message:</p><StartMessage text={data.start_message}/></div>}
    <p className="text-sm">The code works once and makes you the bot's owner. Then setup goes on in the chat: you connect an AI, about five minutes. Getting to know you comes afterwards, whenever you like.</p>
    <div className="flex flex-wrap gap-3"><Button variant="ghost" className="min-h-11" onClick={()=>setReplacing(true)}>Use a different bot</Button>{continueButton}</div>
  </div>;
  else if(phase==='setting-up')body=<div className="space-y-4" role="status">
    <p>{data.owner?data.owner+', setup':'Setup'} is running in your chat with <strong>@{username}</strong>. Answer its questions there; this page follows along.</p>
    {continueButton}
  </div>;
  else if(phase==='ready')body=<div className="space-y-4">
    <p className="flex items-center gap-2" role="status"><CheckCircle2 className="h-5 w-5 text-green-500" aria-hidden="true"/>Telegram is connected. Write to <a className="underline" href={'https://t.me/'+username} target="_blank" rel="noopener noreferrer">@{username}</a> from any phone or computer, and your mission control writes to you there.</p>
    {welcome?continueButton:leaving?<div className="flex flex-wrap gap-3 items-center"><span>Your mission control stops answering in Telegram. Disconnect?</span><Button variant="destructive" className="min-h-11" disabled={busy} onClick={disconnect}>Disconnect</Button><Button variant="ghost" className="min-h-11" onClick={()=>setLeaving(false)}>Keep it</Button></div>:<div className="flex flex-wrap gap-3"><Button variant="outline" className="min-h-11" onClick={()=>setReplacing(true)}>Use a different bot</Button><Button variant="ghost" className="min-h-11" onClick={()=>setLeaving(true)}>Disconnect Telegram</Button></div>}
  </div>;
  else body=<p role="alert">Telegram returned a status this page does not understand. Refresh the page or ask the person who runs this server to update it.</p>;
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
