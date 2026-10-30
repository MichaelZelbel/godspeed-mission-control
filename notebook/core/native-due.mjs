import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {hash} from './records/store.mjs';
import {localPath} from './local-path.mjs';
import {copyOldReminders,writable} from './due-copy.mjs';
const {createDueCommands}=createRequire(import.meta.url)('../../tools/due.js');
// A file in due/ that tools/due.js cannot read is 'needs-a-look', never closed (9 October 2026: an
// assistant's hand-written deadline showed here as closed). It carries the reason and is said in the
// deadline reminders every day until it is fixed.
export function dueRows(store,now=new Date(),{copy:alsoCopy=true}={}){
 const timezone=store.get('settings','installation')?.timezone||'UTC',day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 // THE STORE THIS SCREEN ALREADY HAS, and the lock it may already hold: tools/due.js reads the
 // reminders out of the notebook's records now (#90), and the workspace lock is one writer at a
 // time and is never re-entered. It takes in what an older version left in due/ on the way, which
 // costs nothing when no file there has changed. A staged or read-only copy of the workspace is
 // only read (writable), and work that cannot finish is left to the next read.
 return createDueCommands({root:store.root,commandArgs:[],date:day,store,copy:alsoCopy&&writable(store)}).stateRows().map(r=>({id:'due-'+r.slug,type:'deadlines',uid:hash('due/'+r.slug).slice(0,32),title:r.title,native_file:'due/'+r.slug+'.md',native_slug:r.slug,status:['closed','dropped'].includes(r.state)?'closed':r.state,...(r.problem?{problem:r.problem}:{}),start_at:r.firstDay?r.firstDay+'T00:00:00Z':null,due_at:r.lastDay?r.lastDay+'T23:59:59Z':null,target_at:r.targetDay?r.targetDay+'T23:59:59Z':null,completion_check:r.doneWhen,completion_evidence:r.closedBy,closed_at:r.closedOn,band:r.band,attention:r.attention,sentence:r.sentence,_hash:hash(r),created_at:(r.firstDay||day)+'T00:00:00Z'}));
}
export function dueCommand(store,args,{copy:alsoCopy=true}={}){
 if(!Array.isArray(args)||!['add','done','target','drop','check','state','list','today','help','--help','-h','marker'].includes(args[0])||args.some(a=>typeof a!=='string'||a.length>20000)||args.some(a=>a==='--godspeed'||a.startsWith('--godspeed=')))throw Error('Unsupported obligation command');
 if(args[0]==='help')args=['--help',...args.slice(1)];
 if(['add','done','target','drop','marker'].includes(args[0])&&!(args[0]==='marker'&&['--needed','--stale'].includes(args[1]))&&!/^[a-z0-9][a-z0-9-]{0,59}$/.test(args[1]||''))throw Error('Choose an obligation slug inside the isolated workspace');
 const marker=args.indexOf('--set');if(marker>=0&&(!args[marker+1]||/[\r\n\t]/.test(args[marker+1])))throw Error('Calendar event identity must be a single line');
 const selfCheck=args.indexOf('--self-check-arg');if(selfCheck>=0)localPath(store.root,args[selfCheck+1]||'');
 // Historical self-check paths are never allowed to inspect another installation. They are in the
 // notebook's own records now (#90), and in the files of due/ only until those are retired.
 if(args[0]==='check'){
  for(const record of store.list('deadlines'))if(record.self_check_arg)localPath(store.root,String(record.self_check_arg));
  if(fs.existsSync(path.join(store.root,'due')))for(const file of fs.readdirSync(path.join(store.root,'due')).filter(f=>f.endsWith('.md'))){const match=fs.readFileSync(localPath(store.root,'due/'+file),'utf8').match(/^SELF-CHECK-ARG:\s*(.+)$/m);if(match)localPath(store.root,match[1]);}
 }
 const timezone=store.get('settings','installation')?.timezone||'UTC',day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),script=fileURLToPath(new URL('../../tools/due.js',import.meta.url));
 // THE CHILD TAKES THE WORKSPACE LOCK ITSELF, AND THIS DOES NOT HOLD IT (30 October 2026, #90).
 // tools/due.js writes the notebook's own records now, so it opens the workspace; the lock is one
 // writer at a time and is never re-entered, so a child started inside a lock held here would be
 // told the workspace is busy and could do nothing at all. It takes in what an older version left
 // in due/ before it answers, and retires those files afterwards, both under its own lock.
 const run=spawnSync(process.execPath,[script,...args,'--godspeed',store.root],{cwd:store.root,encoding:'utf8',timeout:15000,windowsHide:true,shell:false,env:{...process.env,GODSPEED_TODAY:day}});
 // What the child wrote, for the reader that is about to ask this store for it.
 store.scan(true);
 if(run.status!==0)throw Object.assign(Error(String(run.stderr||run.stdout||'Obligation command failed').slice(0,500)),{status:run.status});
 return {result:run.stdout.trim()};
}
// A DEADLINE SAVED IN SETTINGS OR TOLD IN THE NOTEBOOK'S CHAT IS A FILE IN due/ (18 October 2026).
// Until then Settings > Obligations and reminders saved a notebook record, while the 08:00 deadline
// reminders and the morning brief read only due/ (tools/due.js), so such a deadline was never
// mentioned. Now it is made the way mc-due add makes one, with the two answers mc-due asks for: what
// is true when it is done, and, for a deadline, what slipping past it costs. Dates are the person's
// days, on the installation's clock. A name already used gets a number, never a second file for
// the same name. {title, done_when, due_at?, target_at?, start_at?, cost?, recurrence?:{days}}
const slugOf=title=>String(title).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,50).replace(/-+$/,'')||'deadline';
export function addDueObligation(store,input,{copy:alsoCopy=true}={}){
 const title=String(input?.title||'').trim();if(!title)throw Error('Say what needs doing');
 if(/[\r\n]/.test(title)||title.length>300)throw Error('Give what needs doing in one line');
 const doneWhen=String(input.done_when||'').trim();if(!doneWhen)throw Error('Say what is true when it is done, so the reminders know when to stop');
 const timezone=store.get('settings','installation')?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'UTC';
 const day=(value,label)=>{if(value===undefined||value===null||value==='')return '';const at=Date.parse(value);if(!Number.isFinite(at))throw Error(label+' needs a real date');return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);};
 const to=day(input.due_at,'The deadline'),target=day(input.target_at,'The day you would like it done'),from=day(input.start_at,'The day you can start');
 if(!to&&!target)throw Error('An obligation needs a target or a deadline');
 const cost=String(input.cost||'').trim();if(to&&!cost)throw Error('Say what it costs you if the deadline passes');
 const days=input.recurrence?.days;if(days!==undefined&&days!==null&&(!Number.isInteger(days)||days<1||days>366))throw Error('Repeat after 1 to 366 days');
 const repeats=!days?'no':days===7?'weekly':days===14?'fortnightly':'every '+days+' days';
 const args=['--title',title,'--done-when',doneWhen,...(to?['--to',to,'--cost',cost]:[]),...(target?['--target',target]:[]),...(from?['--from',from]:[]),'--repeats',repeats];
 const base=slugOf(title);let last=null;
 // A name already used, in the notebook's records or in a file of due/ that is still there: the
 // next number, never a second reminder for the same thing.
 const taken=new Set(store.list('deadlines').filter(r=>r.native_slug).map(r=>r.native_slug));
 for(let n=1;n<=30;n++){
  const slug=n===1?base:base.slice(0,56)+'-'+n;if(taken.has(slug)||fs.existsSync(path.join(store.root,'due',slug+'.md')))continue;
  try{const made=dueCommand(store,['add',slug,...args],{copy:alsoCopy});const row=dueRows(store,new Date(),{copy:alsoCopy}).find(r=>r.native_slug===slug);return {...(row||{id:'due-'+slug,native_slug:slug,title}),result:made.result};}
  catch(error){last=error;if(/already have one called|was used before/.test(error.message))continue;throw Error(String(error.message).split('\n').filter(Boolean).slice(0,2).join(' '));}
 }
 throw last||Error('Choose another name for this obligation');
}
// A deadline Settings saved as a notebook record before 18 October 2026 was never reminded. On the
// machine that runs the routines each one still open becomes a file in due/ once, and its record is
// closed with the file's name, so it is listed once. The two answers it was never asked are written
// in words that say so; the file is the person's to correct.
export function moveSettingsDeadlines(store){
 const moved=[];
 for(const d of store.list('deadlines').filter(r=>r.status==='open'&&!r.moved_to&&!r.removed_at)){
  // THE RECORD SETTINGS SAVED LEAVES Deadlines/ FIRST, and only then is the reminder made. A
  // deadline carrying moved_to keeps its place in _system/ and is nobody's page
  // (records/layout.mjs, isReadable), so one reminder is never two; while it was still open, the
  // reminder's own page was written beside it under the same title with a number and kept that
  // name for good (30 October 2026, when the reminder itself became a page). If the reminder
  // cannot be made after all, this record is put back exactly as it was.
  const back={id:d.id,status:d.status,closed_at:d.closed_at??null,moved_to:null};
  try{
   store.save('deadlines',{id:d.id,status:'closed',closed_at:new Date().toISOString(),moved_to:'due/'+slugOf(d.title)+'.md'});
   const row=addDueObligation(store,{title:d.title,done_when:d.completion_check?.text?'The note it was tied to says: '+d.completion_check.text:d.title+': done.',cost:'Not said when it was saved in Settings.',due_at:d.due_at,target_at:d.target_at,start_at:d.start_at&&Date.parse(d.start_at)>Date.parse(d.created_at||0)?d.start_at:undefined,recurrence:d.recurrence},{copy:false});
   const file=row.native_file||'due/'+row.native_slug+'.md';
   if(file!=='due/'+slugOf(d.title)+'.md')store.save('deadlines',{id:d.id,moved_to:file});
   moved.push(row.native_slug);
  }catch{try{store.save('deadlines',back);}catch{}}
 }
 if(moved.length)copy(store,new Intl.DateTimeFormat('en-CA',{timeZone:store.get('settings','installation')?.timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
 return moved;
}
export function dueDelivered(store,slugs,now=new Date()){const timezone=store.get('settings','installation')?.timezone||'UTC',day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(now);return store.withLock(()=>createDueCommands({root:store.root,date:day,commandArgs:[],store,copy:false}).recordSaid(slugs,day));}
// The copy of the old files into the notebook's records, where the brief, the 08:00 reminders,
// Settings and the add-ons already hold the workspace lock. Cheap when nothing changed, and never
// the reason an answer fails: a copy left undone is done by the next run.
function copy(store,day){try{copyOldReminders(store,{day});}catch(error){if(process.env.GODSPEED_DUE_COPY==='say')console.error('due-copy: not this time: '+error.message);}}
