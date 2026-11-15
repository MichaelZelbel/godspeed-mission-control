import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {authRequest} from '@/contexts/AuthContext';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {ArrowRight,CheckCircle2,Download,Loader2} from 'lucide-react';

type Summary={notes:number;trashedNotes:number;contacts:number;attachments:number;items:number;keptExisting:number;archivedTables:number;backupSaved?:boolean};
type Job={id:string;state:'preparing'|'ready'|'importing'|'complete'|'failed';progress:string;summary?:Summary;copyDate?:string;error?:string};
type Status={prepared:boolean;connected:boolean;job:Job|null};
export function MenerioImportCard(){
  const queryClient=useQueryClient();
  const [status,setStatus]=useState<Status|null>(null),[error,setError]=useState(''),[sending,setSending]=useState(false),[confirmed,setConfirmed]=useState(false),[connect,setConnect]=useState(false);
  const [project,setProject]=useState(''),[apiKey,setApiKey]=useState(''),[token,setToken]=useState('');
  const job=status?.job,busy=job?.state==='preparing'||job?.state==='importing';
  async function refresh(){try{setStatus(await authRequest('/api/menerio/import'));setError('');}catch(e:any){setError(e.message);}}
  useEffect(()=>{refresh();},[]);
  useEffect(()=>{
    if(!busy)return;
    const timer=setInterval(refresh,2000);return()=>clearInterval(timer);
  },[busy]);
  useEffect(()=>{if(job?.state==='complete')queryClient.invalidateQueries({refetchType:'none'});},[job?.state,queryClient]);
  async function start(source:'prepared'|'connected'|'account'){
    setSending(true);setError('');setConfirmed(false);
    try{
      const result=await authRequest('/api/menerio/import',{action:'preview',source,...(source==='account'?{project,apiKey,token}:{})});
      setStatus(current=>({...current!,job:result.job}));setApiKey('');setToken('');setConnect(false);
    }catch(e:any){setError(e.message);}finally{setSending(false);}
  }
  async function apply(){
    setSending(true);setError('');
    try{const result=await authRequest('/api/menerio/import',{action:'apply',id:job?.id});setStatus(current=>({...current!,job:result.job}));}
    catch(e:any){setError(e.message);}finally{setSending(false);}
  }
  const summary=job?.summary;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><Download className="h-5 w-5 text-primary" aria-hidden="true"/>Import from Menerio</CardTitle><CardDescription>Bring your notes, people and attachments into Godspeed Mission Control. Preview the copy before adding it.</CardDescription></CardHeader>
    <CardContent className="space-y-5">
      {error&&<div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm space-y-2"><p>{error}</p><Button variant="outline" className="min-h-11" onClick={refresh}>Check connection again</Button></div>}
      {!status&&!error&&<p role="status" className="text-sm text-muted-foreground">Checking available copies…</p>}
      {busy&&<div role="status" className="flex items-start gap-3 rounded-lg bg-muted/40 p-4"><Loader2 className="h-5 w-5 animate-spin shrink-0 text-primary" aria-hidden="true"/><div><p className="text-sm font-medium">{job.progress}</p><p className="text-sm text-muted-foreground mt-1">You can leave this screen and return. The copy continues on your server.</p></div></div>}
      {job?.state==='failed'&&<p role="alert" className="text-sm text-destructive">{job.error}</p>}
      {summary&&(job?.state==='ready'||job?.state==='complete')&&<div className="space-y-4">
        <div className="flex items-center gap-2 font-medium">{job.state==='complete'&&<CheckCircle2 className="h-5 w-5 text-success" aria-hidden="true"/>}{job.state==='ready'?'Your copy is ready to review':'Your Menerio copy is now in Godspeed'}</div>
        {job.copyDate&&<p className="text-sm text-muted-foreground">Source copy checked {new Date(job.copyDate).toLocaleString()}.</p>}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 rounded-lg bg-muted/30 p-4">{[['Notes',summary.notes],['Trashed notes',summary.trashedNotes],['People',summary.contacts],['Attachments',summary.attachments]].map(([label,value])=><div key={label}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-2xl font-semibold mt-1">{Number(value).toLocaleString()}</dd></div>)}</dl>
        <p className="text-sm text-muted-foreground">{summary.keptExisting.toLocaleString()} existing items kept. Matching items keep your current Godspeed version. {summary.archivedTables>0&&'Data from features Godspeed does not yet support stays in a private archive.'}</p>
        {job.state==='ready'?<>
          <p className="text-sm text-muted-foreground">A backup is saved before copying. Your Menerio account and Godspeed AI connection stay unchanged.</p>
          <label className="flex items-start gap-3 min-h-11 text-sm cursor-pointer"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary"/><span>Add this copy to my existing Godspeed content.</span></label>
          <Button onClick={apply} disabled={!confirmed||sending} className="min-h-11 gap-2 disabled:opacity-100 disabled:bg-muted disabled:text-foreground">{sending?'Starting…':'Import this copy'}<ArrowRight className="h-4 w-4" aria-hidden="true"/></Button>
        </>:<><p className="text-sm text-muted-foreground">Your backup is saved. Your original Menerio account has not been changed.</p><Button asChild className="min-h-11"><Link to="/dashboard/notes">Open your notes</Link></Button></>}
      </div>}
      {status&&!busy&&<div className="space-y-3 border-t pt-5">
        {status.prepared&&<div className="space-y-2"><p className="text-sm text-muted-foreground">A verified Menerio copy is available on this server.</p><Button variant={job?.state==='ready'?'outline':'default'} onClick={()=>start('prepared')} disabled={sending} className="min-h-11">{sending?'Starting…':'Preview saved Menerio copy'}</Button></div>}
        {status.connected&&<Button variant="outline" onClick={()=>start('connected')} disabled={sending} className="min-h-11">Prepare latest Menerio copy</Button>}
        <Button variant="ghost" onClick={()=>setConnect(!connect)} className="min-h-11 px-0 text-primary">{connect?'Close account connection':status.prepared||status.connected?'Copy from another Menerio account':'Connect to Menerio'}</Button>
        {connect&&<form onSubmit={e=>{e.preventDefault();start('account');}} className="space-y-4 max-w-xl">
          <p className="text-sm text-muted-foreground">Use your Menerio project and access keys to make a private copy. The keys are used for this copy and are not saved. A GitHub notes export does not contain the complete account.</p>
          <div className="space-y-2"><Label htmlFor="menerio-project">Menerio project address</Label><Input id="menerio-project" required placeholder="https://your-project.supabase.co" value={project} onChange={e=>setProject(e.target.value)} autoComplete="off" className="min-h-11"/></div>
          <div className="space-y-2"><Label htmlFor="menerio-key">Menerio personal API key</Label><Input id="menerio-key" type="password" required value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="off" className="min-h-11"/><p className="text-sm text-muted-foreground">Available under API keys in your Menerio settings.</p></div>
          <div className="space-y-2"><Label htmlFor="menerio-access">Supabase account access token</Label><Input id="menerio-access" type="password" required value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" className="min-h-11"/><p className="text-sm text-muted-foreground">Used to read the database and download attachments from the project you own.</p></div>
          <Button type="submit" disabled={sending} className="min-h-11">Prepare preview</Button>
        </form>}
      </div>}
    </CardContent></Card>;
}
