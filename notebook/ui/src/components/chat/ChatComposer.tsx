import {useEffect,useRef,useState} from 'react';
import {Plus,ArrowUp,Square,Mic,Volume2,VolumeX,X,FileText,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {loadChatOptions} from '@/local/chat-options.mjs';

export type ChatFile={path:string;name:string;type:string;text?:string};
type Props={value:string;onChange:(text:string)=>void;onSend:()=>void;onStop:()=>void;busy:boolean;files:ChatFile[];onFiles:(files:ChatFile[])=>void;model:string;effort:string;onModel:(v:string)=>void;onEffort:(v:string)=>void;reply:string;context?:string;compact?:boolean;onError:(message:string)=>void};
export default function ChatComposer(p:Props){
  const picker=useRef<HTMLInputElement>(null),recorder=useRef<MediaRecorder|null>(null),recordingTimer=useRef<ReturnType<typeof setTimeout>>(),audioRequest=useRef<AbortController|null>(null),playbackUtterance=useRef<SpeechSynthesisUtterance|null>(null),mounted=useRef(true),draft=useRef(p.value);
  draft.current=p.value;
  const [uploading,setUploading]=useState(false),[listening,setListening]=useState(false),[transcribing,setTranscribing]=useState(false),[speaking,setSpeaking]=useState(false),[dragging,setDragging]=useState(false);
  const [options,setOptions]=useState<{current:string;label?:string;models:Array<{id:string;efforts:string[]}>}>({current:'',models:[]});
  const [modelError,setModelError]=useState(''),[modelAttempt,setModelAttempt]=useState(0);
  const canRecord=!!navigator.mediaDevices?.getUserMedia&&typeof MediaRecorder!=='undefined';
  useEffect(()=>{let alive=true;const request=new AbortController();setModelError('');loadChatOptions({signal:request.signal}).then(data=>{if(alive){setOptions(data);p.onModel(data.current);}}).catch(e=>{if(alive)setModelError(e.message||'Model choices could not be loaded. Try again.');});return()=>{alive=false;request.abort();};},[modelAttempt]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(recordingTimer.current);audioRequest.current?.abort();if(recorder.current?.state==='recording')recorder.current.stop();recorder.current?.stream.getTracks().forEach(t=>t.stop());window.speechSynthesis?.cancel();};},[]);
  const efforts=options.models.find(m=>m.id===p.model)?.efforts||[];
  const addFiles=async(list:FileList|File[])=>{
    const files=Array.from(list);if(p.files.length+files.length>10){p.onError('Attach up to 10 files per message');return;}
    if(files.reduce((n,f)=>n+f.size,0)>20*1024*1024){p.onError('Choose files totaling at most 20 MB');return;}
    setUploading(true);const added:ChatFile[]=[];
    try{for(const file of files){
      let text:string|undefined;
      if(file.type==='application/pdf'||/\.pdf$/i.test(file.name)){
        const pdfjs=await import('pdfjs-dist'),worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');pdfjs.GlobalWorkerOptions.workerSrc=worker.default;
        const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
        try{if(pdf.numPages>100)throw new Error('Attach a PDF of at most 100 pages');text='';for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n),content=await page.getTextContent();text+='\nPage '+n+'\n'+content.items.map((i:any)=>i.str||'').join(' ');if(text.length>60000)throw new Error('This PDF is too long for one message. Attach a shorter document.');}if(!text.replace(/Page \d+/g,'').trim())throw new Error('This PDF contains scanned pages. Attach its page images to discuss them.');}finally{await pdf.destroy();}
      }else if(!file.type.startsWith('image/')&&!file.type.startsWith('text/')&&!/\.(txt|md|csv|json|log|xml|html|yaml|yml)$/i.test(file.name))throw new Error('Attach images, PDFs, or text documents');
      const path='chat/'+crypto.randomUUID()+'/'+file.name,form=new FormData();form.set('file',file);form.set('path',path);
      if(text)form.set('extracted_text',text);
      const response=await fetch('/api/media/upload',{method:'POST',body:form}),result=await response.json();if(!response.ok)throw new Error(result.error||'The file could not be uploaded');
      added.push({path,name:file.name,type:file.type});
    }}catch(e:any){p.onError(e.message||'The file could not be uploaded');}finally{p.onFiles([...p.files,...added]);setUploading(false);if(picker.current)picker.current.value='';}
  };
  const dictate=async()=>{
    if(listening){recorder.current?.stop();return;}if(!canRecord||audioRequest.current)return;
    const controller=new AbortController();audioRequest.current=controller;let stream:MediaStream|undefined;
    try{
      stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(!mounted.current||controller.signal.aborted){stream.getTracks().forEach(t=>t.stop());return;}
      const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t));
      const r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks:Blob[]=[];recorder.current=r;
      r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      r.onerror=()=>{controller.abort();if(r.state==='recording')r.stop();stream.getTracks().forEach(t=>t.stop());if(mounted.current){setListening(false);p.onError('The microphone could not record. Please try again.');}};
      r.onstop=async()=>{
        clearTimeout(recordingTimer.current);stream.getTracks().forEach(t=>t.stop());recorder.current=null;
        if(!mounted.current||controller.signal.aborted){audioRequest.current=null;return;}
        setListening(false);setTranscribing(true);
        try{const audio=new Blob(chunks,{type:r.mimeType}),response=await fetch('/api/chat/transcribe',{method:'POST',headers:{'Content-Type':r.mimeType},body:audio,signal:controller.signal}),result=await response.json();if(!response.ok)throw new Error(result.error||'Dictation could not be transcribed');if(mounted.current)p.onChange([draft.current,result.text].filter(Boolean).join(' '));}catch(e:any){if(mounted.current&&!controller.signal.aborted)p.onError(e.message||'Dictation could not be transcribed');}finally{audioRequest.current=null;if(mounted.current)setTranscribing(false);}
      };
      r.start();setListening(true);recordingTimer.current=setTimeout(()=>{if(r.state==='recording')r.stop();},60000);
    }catch(e:any){stream?.getTracks().forEach(t=>t.stop());audioRequest.current=null;if(mounted.current){setListening(false);p.onError(e.name==='NotAllowedError'?'Allow microphone access to dictate your message.':e.name==='NotFoundError'?'No microphone was found. Connect one to use dictation.':'The microphone could not start. Please try again.');}}
  };
  const playback=()=>{playbackUtterance.current=null;speechSynthesis.cancel();if(speaking){setSpeaking(false);return;}const utterance=new SpeechSynthesisUtterance(p.reply.replace(/[#*`]/g,''));playbackUtterance.current=utterance;utterance.onend=()=>{if(playbackUtterance.current===utterance)setSpeaking(false);};utterance.onerror=event=>{if(playbackUtterance.current!==utterance||!mounted.current)return;setSpeaking(false);if(!['canceled','interrupted'].includes(event.error))p.onError('Audio playback could not start. Check your device’s voice settings.');};speechSynthesis.speak(utterance);speechSynthesis.resume();setSpeaking(true);};
  return <div className={'rounded-2xl border bg-background shadow-sm '+(dragging?'ring-2 ring-primary':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!p.busy)void addFiles(e.dataTransfer.files);}}>
    {p.context&&<div className="border-b px-4 py-2 text-xs text-muted-foreground truncate" title={p.context}>{p.context}</div>}
    {modelError&&<div className="px-4 pt-3 text-xs"><p role="alert">{modelError}</p><Button variant="ghost" size="sm" disabled={p.busy} onClick={()=>setModelAttempt(n=>n+1)}>Reload model choices</Button></div>}
    {p.files.length>0&&<div className="flex flex-wrap gap-2 px-3 pt-3">{p.files.map((file,i)=><div key={file.path} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs max-w-full">{file.type.startsWith('image/')?<img alt="" className="h-8 w-8 rounded object-cover" src={'/api/media/file/'+encodeURIComponent(file.path)}/>:<FileText className="h-4 w-4 shrink-0"/>}<span className="truncate max-w-40">{file.name}</span><Button variant="ghost" size="icon" className="h-10 w-10" aria-label={'Remove '+file.name} disabled={p.busy} onClick={()=>p.onFiles(p.files.filter((_,n)=>n!==i))}><X className="h-4 w-4"/></Button></div>)}</div>}
    <Textarea aria-label="Message" placeholder="Ask Godspeed..." value={p.value} onChange={e=>p.onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!p.busy&&!uploading&&!listening&&!transcribing)p.onSend();}}} rows={p.compact?1:2} className={(p.compact?"min-h-14 ":"min-h-20 ")+"max-h-48 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 px-4 py-3"}/>
    {(listening||transcribing)&&<div role="status" className="px-4 pb-1 text-xs text-muted-foreground">{listening?'Listening… Click the microphone to finish.':'Turning your speech into text…'}</div>}
    <div className="flex flex-nowrap items-center gap-1 px-2 pb-2" data-chat-toolbar>
      <input ref={picker} type="file" multiple className="hidden" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json,.log,.xml,.html,.yaml,.yml" aria-label="Choose attachments" onChange={e=>{if(e.target.files)void addFiles(e.target.files);}}/>
      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Add files" title="Add images, PDFs, or text files" disabled={p.busy||uploading} onClick={()=>picker.current?.click()}>{uploading?<Loader2 className="h-5 w-5 animate-spin"/>:<Plus className="h-5 w-5"/>}</Button>
      <select aria-label="Model" title={p.model} className="h-11 flex-1 basis-0 rounded-md bg-transparent text-xs px-1 min-w-0 max-w-40 focus-visible:outline focus-visible:outline-primary" disabled={p.busy||!options.models.length} value={p.model} onChange={e=>{p.onModel(e.target.value);p.onEffort('');}}>{!options.models.length&&<option value="">{modelError?'Model choices unavailable':'Loading models...'}</option>}{options.models.map(m=><option key={m.id} value={m.id}>{m.id||options.label||'Connected model'}</option>)}</select>
      <select aria-label="Reasoning effort" title={p.effort||'Automatic effort'} className="h-11 flex-1 basis-0 min-w-0 rounded-md bg-transparent text-xs px-1 max-w-24" value={p.effort} disabled={p.busy||!efforts.length} onChange={e=>p.onEffort(e.target.value)}><option value="">Auto</option>{efforts.map(e=><option key={e} value={e}>{e==='none'?'None':e[0].toUpperCase()+e.slice(1)}</option>)}</select>
      <div className="flex shrink-0 items-center ml-auto">
        <Button variant="ghost" size="icon" className={'h-11 w-11 '+(listening?'text-red-500':'')} aria-pressed={listening} aria-label={transcribing?'Transcribing recording':listening?'Stop dictation':'Dictate message'} title={canRecord?'Dictate message':'Microphone access requires HTTPS or localhost'} disabled={!canRecord||p.busy||transcribing} onClick={()=>void dictate()}>{transcribing?<Loader2 className="h-4 w-4 animate-spin"/>:<Mic className="h-4 w-4"/>}</Button>
        <Button variant="ghost" size="icon" className={'h-11 w-11 '+(speaking?'text-primary':'')} aria-pressed={speaking} aria-label={speaking?'Stop reading aloud':'Read last reply aloud'} title={window.speechSynthesis?(speaking?'Stop reading aloud':'Read last reply aloud'):'Playback is unavailable in this browser'} disabled={!p.reply||!window.speechSynthesis} onClick={playback}>{speaking?<Volume2 className="h-4 w-4"/>:<VolumeX className="h-4 w-4"/>}</Button>
        <Button size="icon" className="h-11 w-11 rounded-full" aria-label={p.busy?'Stop reply':'Send message'} disabled={!p.busy&&(uploading||listening||transcribing||(!p.value.trim()&&!p.files.length))} onClick={p.busy?p.onStop:p.onSend}>{p.busy?<Square className="h-4 w-4 fill-current"/>:<ArrowUp className="h-5 w-5"/>}</Button>
      </div>
    </div>
  </div>;
}
