import {useState} from 'react';
import {Link} from 'react-router-dom';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts';
import {AlertTriangle,CheckCircle2,CircleDashed,Clock,Send,XCircle} from 'lucide-react';
import {SEOHead} from '@/components/SEOHead';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import {Card,CardContent,CardHeader,CardTitle} from '@/components/ui/card';

// The Goals page (18 October 2026). Until now a goal was one box inside Settings that showed its title
// and the words typed into it, and nothing of what the loop did. Here each goal shows its weekly number
// and its readings over time, what each step was expected to do to that number and what it did,
// today's decision, the work done and whether its check passed, what went out, the research brief and
// the limit it names, and when the next check comes; and this week's number can be told in one line.
// Everything comes from GET /api/goals/overview (notebook/core/goal-overview.mjs), which reads what the
// loop's own programs wrote and changes nothing.
type Reading={date:string;value:number;where:string};
type Result={date:string;work:string;verdict:string;line:string};
type Bet={work:string;from:number;to:number;title:string;date:string;live:string|null;due:string|null;result:Result|null;what:string};
type Work={id:string;what:string;status:string;done_when:string;outward:boolean;standing:string;goes_out:string;announced:string;needs:string;result:string;link:string;filed:string;next_try:string;verified:{date:string;how:string}|null;unverified:{date:string;why:string}|null;failed:{date:string;why:string}|null;stopped:{date:string;words:string}|null};
type Brief={updated:string;limit:string|null;text:string};
type Goal={id:string;kind:string;status:string;title:string;own_words:string;measure:string;deadline:string;lead:{what:string;kind:string;where:string}|null;readings:Reading[];bets:Bet[];due_now:string[];next_verdict:string|null;progress:{date:string;text:string}[];research:{state:string;last:string|null;brief:Brief|null}|null;decision:string;work:Work[];_hash?:string};
type Routine={next_run:string|null;last_run:string|null;last_status:string|null;paused:boolean};
type Overview={today:string;decision:{day:string;today:boolean;finished:boolean;for_you:string}|null;routines:Record<string,Routine>;going_out:{n:number;id:string;what:string;goal:string;at:string;shown:boolean}[];goals:Goal[];ai:{available:boolean;source?:string;key?:boolean|null;check?:{ok:boolean;error?:string}|null}};
async function request(route:string,body?:unknown){const r=await fetch('/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;}

const day=(d?:string|null)=>{if(!d)return '';const t=new Date(d.length===10?d+'T12:00:00':d);return isNaN(t.getTime())?d:t.toLocaleDateString(undefined,{day:'numeric',month:'long'});};
const shortDay=(d:string)=>{const t=new Date(d+'T12:00:00');return isNaN(t.getTime())?d:t.toLocaleDateString(undefined,{day:'numeric',month:'short'});};
const moment=(d?:string|null)=>{if(!d)return '';const t=new Date(d);return isNaN(t.getTime())?d:t.toLocaleString(undefined,{weekday:'long',hour:'2-digit',minute:'2-digit'});};
// GOES OUT is written in UTC as YYYY-MM-DDTHH:MM.
const goesOut=(at:string)=>moment(at.length===16?at+':00Z':at);
const number=(v:number)=>v.toLocaleString();
const STATUS:Record<string,string>={adopted:'Active',provisional:'An idea, not worked on yet',paused:'Paused',achieved:'Reached',retired:'Stopped'};
const VERDICT:Record<string,string>={worked:'It worked',moved:'It moved the number, but less than expected',flat:'The number did not move',unread:'No reading came in time to judge it','never-live':'It never went live'};

function workState(w:Work):{icon:JSX.Element;text:string}{
  const good=<CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true"/>,wait=<Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>,warn=<AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true"/>;
  if(w.status==='verified')return w.outward?{icon:<Send className="h-4 w-4 shrink-0 text-green-500" aria-hidden="true"/>,text:'Went out on '+day(w.verified?.date)+(w.standing?', as you allowed':'')+'. Its check passed.'}:{icon:good,text:'Done on '+day(w.verified?.date)+'. Its check passed.'};
  if(w.status==='attempted')return {icon:warn,text:'Done, but its check has not passed yet, so it does not count as done.'};
  if(w.status==='failed')return {icon:<XCircle className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true"/>,text:'Could not be finished'+(w.next_try?', and it is tried again on '+day(w.next_try):'')+'.'};
  if(w.status==='planned')return {icon:wait,text:w.goes_out?'Goes out '+goesOut(w.goes_out)+' unless you say stop.':'Waiting for the daily work at 10:00 or 16:00.'};
  if(w.status==='dispatched')return {icon:wait,text:'Being worked on now.'};
  if(w.status==='blocked')return {icon:wait,text:w.needs==='person'?'Waiting for you.':w.needs==='authorization'?'Waiting for your yes.':'Waiting: it needs '+w.needs.replace(/^capability:/,'')+'.'};
  if(w.status==='stale')return {icon:<CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>,text:'Set aside, to be planned again.'};
  if(w.status==='cancelled')return {icon:<CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true"/>,text:w.stopped?'Stopped, as you said.':'Cancelled.'};
  return {icon:wait,text:w.status};
}

function Readings({goal}:{goal:Goal}){
  const rs=goal.readings,lastReading=rs.at(-1),weekBefore=lastReading?[...rs].reverse().find(r=>(Date.parse(lastReading.date)-Date.parse(r.date))/86400000>=7):undefined;
  if(!lastReading)return <p className="text-sm text-muted-foreground">Not read yet. The morning decision reads it, or you tell it below.</p>;
  return <div className="space-y-3">
    <p><span className="text-3xl font-semibold font-display tabular-nums">{number(lastReading.value)}</span> <span className="text-sm text-muted-foreground">on {day(lastReading.date)}{weekBefore?', '+(lastReading.value-weekBefore.value>=0?'up ':'down ')+number(Math.abs(lastReading.value-weekBefore.value))+' since '+day(weekBefore.date):''}</span></p>
    {rs.length>1&&<div className="h-40" role="img" aria-label={'Readings of '+goal.lead!.what+' over time; the list below has every one'}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rs.map(r=>({...r,label:shortDay(r.date)}))} margin={{top:8,right:12,bottom:0,left:0}}>
          <CartesianGrid vertical={false} className="stroke-border" strokeOpacity={0.6}/>
          <XAxis dataKey="label" tick={{fontSize:11}} tickLine={false} axisLine={false}/>
          <YAxis allowDecimals width={44} tick={{fontSize:11}} tickLine={false} axisLine={false}/>
          <Tooltip contentStyle={{backgroundColor:'hsl(var(--popover))',border:'1px solid hsl(var(--border))',borderRadius:8,fontSize:12}} formatter={(v:number)=>[number(v),goal.lead!.what]}/>
          <Line type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} dot={{r:4,strokeWidth:2,stroke:'hsl(var(--background))',fill:'hsl(var(--primary))'}} activeDot={{r:6}} isAnimationActive={false}/>
        </LineChart>
      </ResponsiveContainer>
    </div>}
    <details><summary className="cursor-pointer text-sm">Every reading ({rs.length})</summary>
      <ul className="mt-2 divide-y text-sm">{[...rs].reverse().map(r=><li key={r.date} className="py-2 flex flex-wrap gap-x-3"><span className="tabular-nums font-medium">{number(r.value)}</span><span>{day(r.date)}</span>{r.where&&<span className="text-muted-foreground">{r.where}</span>}</li>)}</ul>
    </details>
  </div>;
}

function GoalCard({goal,data,operation,busy}:{goal:Goal;data:Overview;operation:(input:any)=>Promise<boolean>;busy:boolean}){
  const [value,setValue]=useState(''),[where,setWhere]=useState(''),[editing,setEditing]=useState(false);
  const active=goal.status==='adopted',decide=data.routines.decide;
  const wentOut=goal.work.filter(w=>w.outward&&w.status==='verified');
  const going=data.going_out.filter(g=>g.goal===goal.id);
  return <Card id={'goal-'+goal.id}>
    <CardHeader className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><CardTitle className="text-xl">{goal.title}</CardTitle><Badge variant={active?'default':'secondary'}>{STATUS[goal.status]||goal.status}</Badge></div>
      {goal.measure&&<p className="text-sm text-muted-foreground">Reached when: {goal.measure}</p>}
    </CardHeader>
    <CardContent className="space-y-6">
      <section className="space-y-3" aria-label="The weekly number">
        <h3 className="text-base font-semibold">The weekly number</h3>
        {goal.lead?<>
          <p className="text-sm">{goal.lead.what}, {goal.lead.kind==='total'?'counted in total':'counted each week'}, read from {goal.lead.where}. Every step for this goal is judged by it.</p>
          <Readings goal={goal}/>
          <form className="flex flex-wrap items-end gap-3" onSubmit={async e=>{e.preventDefault();if(await operation({type:'goal-reading',id:goal.id,value:Number(value.replace(',','.')),...(where.trim()?{where:where.trim()}:{})})){setValue('');setWhere('');}}}>
            <label className="space-y-1 text-sm font-medium">This week's number<Input className="w-36 text-base" inputMode="decimal" required pattern="-?[0-9]+([.,][0-9]+)?" value={value} onChange={e=>setValue(e.target.value)}/></label>
            <label className="space-y-1 text-sm font-medium flex-1 min-w-48">Where you read it (optional)<Input className="text-base" value={where} onChange={e=>setWhere(e.target.value)} placeholder={goal.lead.where}/></label>
            <Button className="min-h-11" disabled={busy}>Save the number</Button>
          </form>
        </>:<NameTheNumber goal={goal} operation={operation} busy={busy}/>}
      </section>

      <section className="space-y-2" aria-label="Today's decision">
        <h3 className="text-base font-semibold">{data.decision?.today?'Today\'s decision':'The latest decision'}</h3>
        {goal.decision?<div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown>{goal.decision}</ReactMarkdown></div>
          :<p className="text-sm text-muted-foreground">{active?'The morning decision has not written about this goal yet.':'A goal that is not active gets no decision.'}{active&&decide?.next_run?' The next one runs '+moment(decide.next_run)+'.':''}</p>}
      </section>

      <section className="space-y-2" aria-label="What each step should do to the number">
        <h3 className="text-base font-semibold">What each step should do to the number</h3>
        {!goal.bets.length?<p className="text-sm text-muted-foreground">No step has an expected effect yet. The morning decision writes one for each step it makes.</p>
          :<ul className="divide-y">{[...goal.bets].reverse().map(b=><li key={b.work} className="py-2 text-sm space-y-1">
            <p className="font-medium">{b.what||b.title}</p>
            <p>Expected: {number(b.from)} to {number(b.to)} within a week of going live.</p>
            <p className="text-muted-foreground">{b.result?(VERDICT[b.result.verdict]||b.result.verdict)+(/->/.test(b.result.line)?': '+(b.result.line.match(/(-?[\d.]+) -> (-?[\d.]+)/)||[]).slice(1,3).map(Number).map(number).join(' to '):'')+', judged on '+day(b.result.date)+'.'
              :b.live?'Went live on '+day(b.live)+'. Judged on '+day(b.due)+' from the readings.':'Not live yet.'}</p>
          </li>)}</ul>}
        {goal.next_verdict&&<p className="text-sm">Next check: {day(goal.next_verdict)}, when the readings show what the step did.</p>}
      </section>

      <section className="space-y-2" aria-label="Steps and their checks">
        <h3 className="text-base font-semibold">Steps and their checks</h3>
        {!goal.work.length?<p className="text-sm text-muted-foreground">No steps yet. The daily work does them at 10:00 and 16:00.</p>
          :<ul className="divide-y">{goal.work.slice(0,12).map(w=>{const s=workState(w);return <li key={w.id} className="py-2 text-sm space-y-1">
            <p className="font-medium">{w.what}</p>
            <p className="flex gap-2 items-start">{s.icon}<span>{s.text}</span></p>
            {w.done_when&&<p className="text-muted-foreground">Done when: {w.done_when}</p>}
            {w.link&&<a className="underline" href={w.link} target="_blank" rel="noopener noreferrer">Open the result</a>}
          </li>;})}</ul>}
        {goal.work.length>12&&<p className="text-sm text-muted-foreground">And {goal.work.length-12} earlier steps.</p>}
      </section>

      {(wentOut.length>0||going.length>0)&&<section className="space-y-2" aria-label="What went out">
        <h3 className="text-base font-semibold">What went out</h3>
        <ul className="text-sm space-y-1">
          {going.map(g=><li key={g.id}>{g.what}: goes out {goesOut(g.at)} unless you say stop{g.shown?'':', after the morning message has shown it'}.</li>)}
          {wentOut.map(w=><li key={w.id}>{w.what}: went out on {day(w.verified?.date)}{w.standing?', as you allowed':''}.</li>)}
        </ul>
      </section>}

      {goal.research&&<section className="space-y-2" aria-label="Research">
        <h3 className="text-base font-semibold">What the research says</h3>
        <p className="text-sm">{goal.research.state==='current'?'Researched every night':goal.research.state==='stale'?'The nightly research has not finished for two days or more':'Being researched for the first time'}{goal.research.last?', last on '+day(goal.research.last):''}.</p>
        {goal.research.brief?.limit&&<p className="text-sm"><span className="font-medium">What holds this goal back now:</span> {goal.research.brief.limit}</p>}
        {goal.research.brief&&<details><summary className="cursor-pointer text-sm">Read the research brief{goal.research.brief.updated?' ('+day(goal.research.brief.updated)+')':''}</summary>
          <div className="prose prose-sm dark:prose-invert max-w-none mt-2"><ReactMarkdown>{goal.research.brief.text.replace(/^(?:[A-Z ]+:.*\n)+/,'')}</ReactMarkdown></div></details>}
      </section>}

      {goal.progress.length>0&&<details><summary className="cursor-pointer text-sm">What happened, as noted ({goal.progress.length})</summary>
        <ul className="mt-2 text-sm space-y-1">{[...goal.progress].reverse().map((p,i)=><li key={i}>{day(p.date)}: {p.text}</li>)}</ul></details>}

      <div className="flex flex-wrap gap-2 border-t pt-4">
        {goal.status!=='adopted'&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>operation({type:'goal-change',id:goal.id,status:'adopted',reason:'Resumed on the Goals page'})}>{goal.status==='provisional'?'Work on this goal':'Resume'}</Button>}
        {goal.status==='adopted'&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>operation({type:'goal-change',id:goal.id,status:'paused',reason:'Paused on the Goals page'})}>Pause</Button>}
        {goal.status==='adopted'&&<Button variant="outline" className="min-h-11" disabled={busy} onClick={()=>operation({type:'goal-change',id:goal.id,status:'achieved',reason:'Reached, said on the Goals page'})}>Goal reached</Button>}
        {goal.status!=='retired'&&<Button variant="ghost" className="min-h-11" disabled={busy} onClick={()=>{if(window.confirm('Stop pursuing "'+goal.title+'"? Its work is cancelled; the goal and its history stay.'))operation({type:'goal-change',id:goal.id,status:'retired',reason:'Stopped on the Goals page'});}}>Stop pursuing</Button>}
        <Button variant="ghost" className="min-h-11" onClick={()=>setEditing(!editing)}>{editing?'Close':'Change this goal'}</Button>
      </div>
      {editing&&<form className="space-y-3" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);if(await operation({type:'goal-change',id:goal.id,title:String(f.get('title')),measure:String(f.get('measure')),reason:String(f.get('reason'))}))setEditing(false);}}>
        <label className="block space-y-1 text-sm font-medium">The goal, in your words<Input name="title" required defaultValue={goal.title} className="text-base"/></label>
        <label className="block space-y-1 text-sm font-medium">Reached when<Input name="measure" required defaultValue={goal.measure} className="text-base"/></label>
        <label className="block space-y-1 text-sm font-medium">Why it changed<Input name="reason" required className="text-base"/></label>
        <p className="text-sm text-muted-foreground">Saving sets aside the steps planned for the old version; the next decision plans new ones.</p>
        <Button className="min-h-11" disabled={busy}>Save the change</Button>
      </form>}
    </CardContent>
  </Card>;
}

function NameTheNumber({goal,operation,busy}:{goal:Goal;operation:(input:any)=>Promise<boolean>;busy:boolean}){
  const [what,setWhat]=useState(''),[kind,setKind]=useState('total'),[where,setWhere]=useState('');
  return <div className="space-y-3">
    <p className="text-sm">No weekly number yet: the one number, counted every week, that shows whether the work moves this goal. The morning decision names one from the research, or you name it here.</p>
    <form className="grid gap-3 sm:grid-cols-3" onSubmit={e=>{e.preventDefault();operation({type:'goal-change',id:goal.id,lead:[what,kind,where].map(s=>s.trim().replace(/\|/g,'/')).join(' | '),reason:'Named on the Goals page'});}}>
      <label className="space-y-1 text-sm font-medium">What is counted<Input className="text-base" required value={what} onChange={e=>setWhat(e.target.value)} placeholder="for example: training sessions"/></label>
      <label className="space-y-1 text-sm font-medium">How<select className="block w-full min-h-11 rounded-md border bg-background px-3 text-base" value={kind} onChange={e=>setKind(e.target.value)}><option value="total">In total</option><option value="per week">Each week</option></select></label>
      <label className="space-y-1 text-sm font-medium">Where it is read<Input className="text-base" required value={where} onChange={e=>setWhere(e.target.value)} placeholder="for example: I count them"/></label>
      <Button className="min-h-11 sm:col-span-3 sm:justify-self-start" disabled={busy}>Name the weekly number</Button>
    </form>
  </div>;
}

function FirstOrNextGoal({first,operation,busy,onFirst}:{first:boolean;operation:(input:any)=>Promise<boolean>;busy:boolean;onFirst:(goal:string)=>Promise<boolean>}){
  const [title,setTitle]=useState(''),[measure,setMeasure]=useState('');
  return <Card><CardHeader><CardTitle className="text-xl">{first?'Your first goal':'Add a goal'}</CardTitle></CardHeader><CardContent>
    <form className="space-y-3" onSubmit={async e=>{e.preventDefault();const saved=first?await onFirst(title.trim()):await operation({type:'goal-add',title:title.trim(),measure:measure.trim()});if(saved){setTitle('');setMeasure('');}}}>
      {first&&<p className="text-sm">Your first goal starts the routines: research at night, a decision each morning, the work during the day. You can also say it in the chat: "Make this a goal: …".</p>}
      <label className="block space-y-1 text-sm font-medium">What do you want to reach?<Input className="text-base" required value={title} onChange={e=>setTitle(e.target.value)} placeholder="Finish the first draft of my novel by March"/></label>
      {!first&&<label className="block space-y-1 text-sm font-medium">How will you know it is reached?<Input className="text-base" required value={measure} onChange={e=>setMeasure(e.target.value)}/></label>}
      <Button className="min-h-11" disabled={busy}>{first?'Start':'Add this goal'}</Button>
    </form>
  </CardContent></Card>;
}

export default function Goals(){
  const qc=useQueryClient(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
  const overview=useQuery({queryKey:['goals-overview'],queryFn:()=>request('goals/overview') as Promise<Overview>,refetchInterval:30000});
  const operation=async(input:any)=>{setBusy(true);setError('');setSaved('');try{await request('functions/personal-operation',input);setSaved(input.type==='goal-reading'?'Saved as this week\'s number.':'Saved.');await qc.invalidateQueries({queryKey:['goals-overview']});return true;}catch(e:any){setError(e.message);return false;}finally{setBusy(false);}};
  const first=async(goal:string)=>{setBusy(true);setError('');try{await request('setup',{goal,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,delivery:'notebook'});await qc.invalidateQueries();return true;}catch(e:any){setError(e.message);return false;}finally{setBusy(false);}};
  const data=overview.data;
  const order=(g:Goal)=>['adopted','provisional','paused','achieved','retired'].indexOf(g.status);
  const goals=(data?.goals||[]).filter(g=>['outcome','strategy','project','commitment'].includes(g.kind)).sort((a,b)=>order(a)-order(b));
  const ai=data?.ai,aiProblem=ai?.available&&(ai.source==='none'||ai.key===false||(ai.check&&!ai.check.ok));
  return <div className="w-full max-w-4xl space-y-6">
    <SEOHead title="Goals - Godspeed Mission Control" noIndex/>
    <header className="space-y-1">
      <h1 className="text-2xl font-bold font-display">Goals</h1>
      <p className="text-muted-foreground">What each goal aims at, what was done for it, and whether the number moved.</p>
    </header>
    {error&&<p role="alert" className="text-red-500">{error}</p>}
    {saved&&<p role="status" className="text-sm">{saved}</p>}
    {aiProblem&&<p className="flex gap-2 items-start rounded border border-amber-500/40 p-3" role="alert"><AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" aria-hidden="true"/><span>Your daily routines cannot reach the AI, so nothing here moves on its own. <Link className="underline" to="/dashboard/settings#connect-ai">Connect your AI in Settings</Link>.</span></p>}
    {overview.isLoading&&<p role="status">Reading your goals…</p>}
    {overview.isError&&<p role="alert">Your goals could not be read. <button className="underline" onClick={()=>overview.refetch()}>Try again</button></p>}
    {data&&<>
      {(data.decision||data.routines.decide)&&<Card><CardContent className="pt-6 space-y-2">
        {data.decision?<>
          <p className="font-medium">{data.decision.today?'This morning\'s decision':'The latest decision, '+day(data.decision.day)}</p>
          {!data.decision.finished?<p className="text-sm">It did not finish, so nothing was decided that day.</p>
            :<div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown>{data.decision.for_you||'Nothing for you today.'}</ReactMarkdown></div>}
        </>:<p className="text-sm">No decision yet.</p>}
        {data.routines.decide?.next_run&&<p className="text-sm text-muted-foreground">The next decision runs {moment(data.routines.decide.next_run)}{data.routines.work?.next_run?', the next work '+moment(data.routines.work.next_run):''}.</p>}
      </CardContent></Card>}
      {data.going_out.length>0&&<Card><CardHeader><CardTitle className="text-lg">Going out unless you say stop</CardTitle></CardHeader><CardContent className="space-y-2">
        <ol className="list-decimal pl-5 text-sm space-y-1">{data.going_out.map(g=><li key={g.id} value={g.n}>{g.what}, {goesOut(g.at)}</li>)}</ol>
        <p className="text-sm text-muted-foreground">Say "stop" in the chat to keep all of them back, or "stop" and a number for one.</p>
      </CardContent></Card>}
      {goals.map(g=><GoalCard key={g.id} goal={g} data={data} operation={operation} busy={busy}/>)}
      <FirstOrNextGoal first={!goals.length} operation={operation} busy={busy} onFirst={first}/>
    </>}
  </div>;
}
