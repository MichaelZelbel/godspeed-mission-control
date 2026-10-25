import {useEffect,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {AlertTriangle,Loader2} from 'lucide-react';

// Settings > Voice replies (25 October 2026, discussion #41; notebook/core/voice-replies.mjs). A voice
// note sent in Telegram is answered with a voice note and the same text. Here: which voice speaks
// (the free one, or the person's ElevenLabs voice with its voice settings), what the chat is set to,
// and the last failure. An ElevenLabs voice is kept only after a short sample worked, and the sample
// plays here.
export type VoiceStatus={available:boolean;
  voice?:{service:'edge'|'elevenlabs'|'hermes';voice_id?:string|null;model?:string;provider?:string;stability?:number|null;similarity_boost?:number|null;style?:number|null};
  elevenlabs?:{voice_id?:string;model:string;stability:number;similarity_boost:number;style:number};
  key?:boolean;chats?:{voice_only:number;all:number;off:number};auto_tts?:boolean|null;
  failing?:{since:string;error:string|null;at:string|null}|null;sample?:string};
async function call(route:string,body?:unknown){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}
const when=(at:string)=>{const d=new Date(at);return isNaN(d.getTime())?at:d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});};
const MODELS=['eleven_multilingual_v2','eleven_v3','eleven_flash_v2_5','eleven_turbo_v2_5'];

export function VoiceState({status}:{status?:VoiceStatus}){
  if(!status?.available||!status.voice)return null;
  const {voice,chats,failing}=status;
  const settings=[voice.stability!=null&&'stability '+voice.stability,voice.similarity_boost!=null&&'similarity '+voice.similarity_boost,voice.style!=null&&'style '+voice.style].filter(Boolean).join(', ');
  return <div className="space-y-2">
    {voice.service==='elevenlabs'?<p>Your assistant speaks with your ElevenLabs voice <strong>{voice.voice_id}</strong> (model {voice.model}{settings?'; '+settings:''}).</p>
      :voice.service==='hermes'?<p>Your assistant speaks with a voice set in Hermes itself ({voice.provider}).</p>
      :<p>Your assistant speaks with the free voice from Microsoft Edge{voice.voice_id?<> (<strong>{voice.voice_id}</strong>)</>:null}.</p>}
    {chats?.off?<p>In your Telegram chat, voice replies are switched off. Send <code>/voice on</code> there to switch them on again.</p>
      :chats?.all?<p>In your Telegram chat every answer is spoken. Send <code>/voice on</code> there to have only your voice notes answered with a voice note.</p>
      :status.auto_tts===false&&!chats?.voice_only?<p>Spoken answers are switched off in Hermes' own settings, so your voice notes get text. Send <code>/voice on</code> in your Telegram chat to switch voice replies on there.</p>
      :null}
    {failing&&<p className="flex gap-2 items-start" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>The last voice note could not be made on {when(failing.at||failing.since)}. {failing.error} Your answers still arrive as text.</span></p>}
  </div>;
}

export function VoiceReplies(){
  const qc=useQueryClient();
  const status=useQuery({queryKey:['voice'],queryFn:()=>call('voice') as Promise<VoiceStatus>});
  const data=status.data;
  const [key,setKey]=useState(''),[voiceId,setVoiceId]=useState(''),[model,setModel]=useState('eleven_multilingual_v2');
  const [stability,setStability]=useState('0.5'),[similarity,setSimilarity]=useState('0.75'),[style,setStyle]=useState('0');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(''),[sample,setSample]=useState('');
  // The form starts with the ElevenLabs voice chosen before, so tuning it means changing one number.
  const [filled,setFilled]=useState(false);
  useEffect(()=>{const saved=data?.elevenlabs;if(filled||!saved)return;setFilled(true);
    if(saved.voice_id)setVoiceId(saved.voice_id);setModel(saved.model);setStability(String(saved.stability));setSimilarity(String(saved.similarity_boost));setStyle(String(saved.style));},[data,filled]);
  if(!status.isLoading&&!data?.available)return null;
  const save=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');setDone('');setSample('');
    try{const result=await call('voice',{service:'elevenlabs',key,voice_id:voiceId,model,stability,similarity_boost:similarity,style,language:navigator.language});
      setKey('');setSample(result.sample||'');qc.setQueryData(['voice'],{...result,sample:undefined});
      setDone('Saved. This is how your assistant sounds now. Your next voice note gets this voice.');
    }catch(err:any){setError(err.message);}finally{setBusy(false);}};
  const free=async()=>{setBusy(true);setError('');setDone('');setSample('');
    try{qc.setQueryData(['voice'],await call('voice',{service:'edge'}));setDone('Your assistant speaks with the free voice again. Your ElevenLabs key stays saved for later.');}
    catch(err:any){setError(err.message);}finally{setBusy(false);}};
  return <section id="voice-replies" className="border rounded p-4 space-y-4" aria-labelledby="voice-replies-title">
    <h2 id="voice-replies-title" className="text-xl">Voice replies</h2>
    <p>When you send your assistant a voice note in Telegram, it answers with a voice note and the same text. Ask in writing for a spoken answer, and you get one too.</p>
    {status.isLoading?<p role="status">Reading your assistant's voice…</p>:<VoiceState status={data}/>}
    <p className="text-sm text-muted-foreground">In the chat, <code>/voice off</code> stops voice replies there, <code>/voice tts</code> makes every answer spoken, and <code>/voice on</code> goes back to answering voice notes with a voice note.</p>
    {data?.voice?.service==='elevenlabs'&&<Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={free}>Use the free voice instead</Button>}
    <form className="space-y-3" onSubmit={save} aria-label="Use an ElevenLabs voice">
      <h3 className="text-lg">Use an ElevenLabs voice</h3>
      <p>Your own voice from ElevenLabs, with its settings as on its voice page. You pay ElevenLabs directly. The key stays on this device.</p>
      <label className="block">ElevenLabs key{data?.key?' (leave it empty to keep the saved one)':''}
        <Input type="password" autoComplete="off" spellCheck={false} required={!data?.key} value={key} onChange={e=>setKey(e.target.value)}/></label>
      <label className="block">Voice ID, from the voice's page at ElevenLabs
        <Input required spellCheck={false} value={voiceId} onChange={e=>setVoiceId(e.target.value)}/></label>
      <label className="block">Model
        <Input required spellCheck={false} list="voice-models" value={model} onChange={e=>setModel(e.target.value)}/></label>
      <datalist id="voice-models">{MODELS.map(m=><option key={m} value={m}/>)}</datalist>
      <div className="flex flex-wrap gap-3">
        <label className="block">Stability<Input type="number" min="0" max="1" step="0.05" required className="w-28" value={stability} onChange={e=>setStability(e.target.value)}/></label>
        <label className="block">Similarity<Input type="number" min="0" max="1" step="0.05" required className="w-28" value={similarity} onChange={e=>setSimilarity(e.target.value)}/></label>
        <label className="block">Style<Input type="number" min="0" max="1" step="0.05" required className="w-28" value={style} onChange={e=>setStyle(e.target.value)}/></label>
      </div>
      <Button className="min-h-11" disabled={busy}>{busy?<><Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden="true"/>Making a sample…</>:'Make a sample and save'}</Button>
      {done&&<p role="status">{done}</p>}
      {sample&&<audio controls src={sample} aria-label="The sample of your assistant's voice"/>}
      {error&&<p role="alert" className="text-red-500">{error}</p>}
    </form>
  </section>;
}
