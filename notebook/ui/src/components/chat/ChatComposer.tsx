import {useEffect,useRef,useState} from 'react';
import {Plus,ArrowUp,Square,Mic,Volume2,VolumeX,X,FileText,Loader2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';

export type ChatFile={path:string;name:string;type:string;text?:string};
type Props={value:string;onChange:(text:string)=>void;onSend:()=>void;onStop:()=>void;busy:boolean;files:ChatFile[];onFiles:(files:ChatFile[])=>void;model:string;effort:string;onModel:(v:string)=>void;onEffort:(v:string)=>void;reply:string;context?:string;compact?:boolean;onError:(message:string)=>void};
export default function ChatComposer(p:Props){
  const picker=useRef<HTMLInputElement>(null),recognition=useRef<any>(null);
  const [uploading,setUploading]=useState(false),[listening,setListening]=useState(false),[speaking,setSpeaking]=useState(false),[dragging,setDragging]=useState(false);
  const [options,setOptions]=useState<{current:string;models:Array<{id:string;efforts:string[]}>}>({current:'',models:[]});
  const SpeechRecognition=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;
  useEffect(()=>{let alive=true;fetch('/api/chat/options').then(async r=>{const data=await r.json();if(!r.ok)throw new Error(data.error);if(alive){setOptions(data);p.onModel(data.current);}}).catch(e=>{if(alive)p.onError(e.message||'Model choices could not be loaded');});return()=>{alive=false;recognition.current?.abort();window.speechSynthesis?.cancel();};},[]);
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
  const dictate=()=>{
    if(listening){recognition.current?.stop();return;}if(!SpeechRecognition)return;
    const r=new SpeechRecognition();r.lang=navigator.language;r.interimResults=false;recognition.current=r;
    r.onresult=(event:any)=>p.onChange([p.value,event.results[0][0].transcript].filter(Boolean).join(' '));
    r.onerror=(event:any)=>{setListening(false);p.onError(event.error==='not-allowed'?'Allow microphone access to use dictation.':'Dictation is unavailable. You can type your message.');};r.onend=()=>setListening(false);try{r.start();setListening(true);}catch{p.onError('Dictation is unavailable in this browser.');}
  };
  const playback=()=>{if(speaking){speechSynthesis.cancel();setSpeaking(false);return;}const utterance=new SpeechSynthesisUtterance(p.reply.replace(/[#*`]/g,''));utterance.onend=()=>setSpeaking(false);utterance.onerror=()=>setSpeaking(false);speechSynthesis.speak(utterance);setSpeaking(true);};
  return <div className={'rounded-2xl border bg-background shadow-sm '+(dragging?'ring-2 ring-primary':'')} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);if(!p.busy)void addFiles(e.dataTransfer.files);}}>
    {p.context&&<div className="border-b px-4 py-2 text-xs text-muted-foreground truncate" title={p.context}>{p.context}</div>}
    {p.files.length>0&&<div className="flex flex-wrap gap-2 px-3 pt-3">{p.files.map((file,i)=><div key={file.path} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs max-w-full">{file.type.startsWith('image/')?<img alt="" className="h-8 w-8 rounded object-cover" src={'/api/media/file/'+encodeURIComponent(file.path)}/>:<FileText className="h-4 w-4 shrink-0"/>}<span className="truncate max-w-40">{file.name}</span><Button variant="ghost" size="icon" className="h-10 w-10" aria-label={'Remove '+file.name} disabled={p.busy} onClick={()=>p.onFiles(p.files.filter((_,n)=>n!==i))}><X className="h-4 w-4"/></Button></div>)}</div>}
    <Textarea aria-label="Message" placeholder="Ask Godspeed..." value={p.value} onChange={e=>p.onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!p.busy&&!uploading)p.onSend();}}} rows={p.compact?1:2} className={(p.compact?"min-h-14 ":"min-h-20 ")+"max-h-48 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 px-4 py-3"}/>
    <div className="flex items-center flex-wrap gap-1 px-2 pb-2">
      <input ref={picker} type="file" multiple className="hidden" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json,.log,.xml,.html,.yaml,.yml" aria-label="Choose attachments" onChange={e=>{if(e.target.files)void addFiles(e.target.files);}}/>
      <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Add files" title="Add images, PDFs, or text files" disabled={p.busy||uploading} onClick={()=>picker.current?.click()}>{uploading?<Loader2 className="h-5 w-5 animate-spin"/>:<Plus className="h-5 w-5"/>}</Button>
      <select aria-label="Model" className="h-11 rounded-md bg-transparent text-xs px-2 min-w-0 max-w-40 focus-visible:outline focus-visible:outline-primary" disabled={p.busy||!options.models.length} value={p.model} onChange={e=>{p.onModel(e.target.value);p.onEffort('');}}>{!options.models.length&&<option value="">Loading models...</option>}{options.models.map(m=><option key={m.id} value={m.id}>{m.id||options.current}</option>)}</select>
      <select aria-label="Reasoning effort" className="h-11 rounded-md bg-transparent text-xs px-2 max-w-28" value={p.effort} disabled={p.busy||!efforts.length} onChange={e=>p.onEffort(e.target.value)}><option value="">Auto effort</option>{efforts.map(e=><option key={e} value={e}>{e==='none'?'No reasoning':e[0].toUpperCase()+e.slice(1)}</option>)}</select>
      <div className="flex items-center ml-auto">
        <Button variant="ghost" size="icon" className={'h-11 w-11 '+(listening?'text-red-500':'')} aria-label={listening?'Stop dictation':'Dictate message'} title={SpeechRecognition?'Dictate message':'Dictation is unavailable in this browser'} disabled={!SpeechRecognition||p.busy} onClick={dictate}><Mic className="h-4 w-4"/></Button>
        <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={speaking?'Stop reading aloud':'Read last reply aloud'} title={window.speechSynthesis?'Read last reply aloud':'Playback is unavailable in this browser'} disabled={!p.reply||!window.speechSynthesis} onClick={playback}>{speaking?<VolumeX className="h-4 w-4"/>:<Volume2 className="h-4 w-4"/>}</Button>
        <Button size="icon" className="h-11 w-11 rounded-full" aria-label={p.busy?'Stop reply':'Send message'} disabled={!p.busy&&(uploading||(!p.value.trim()&&!p.files.length))} onClick={p.busy?p.onStop:p.onSend}>{p.busy?<Square className="h-4 w-4 fill-current"/>:<ArrowUp className="h-5 w-5"/>}</Button>
      </div>
    </div>
  </div>;
}
