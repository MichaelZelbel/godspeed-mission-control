import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import {hash} from './records/store.mjs';
import {localPath} from './local-path.mjs';
const {createDueCommands}=createRequire(import.meta.url)('../../tools/due.js');
export function dueRows(store,now=new Date()){
 if(!fs.existsSync(path.join(store.root,'due')))return [];
 const timezone=store.get('settings','installation')?.timezone||'UTC',day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 return createDueCommands({root:store.root,commandArgs:[],date:day}).stateRows().map(r=>({id:'due-'+r.slug,type:'deadlines',uid:hash('due/'+r.slug).slice(0,32),title:r.title,native_file:'due/'+r.slug+'.md',native_slug:r.slug,status:['closed','dropped'].includes(r.state)?'closed':r.state,start_at:r.firstDay?r.firstDay+'T00:00:00Z':null,due_at:r.lastDay?r.lastDay+'T23:59:59Z':null,target_at:r.targetDay?r.targetDay+'T23:59:59Z':null,completion_check:r.doneWhen,completion_evidence:r.closedBy,closed_at:r.closedOn,band:r.band,attention:r.attention,sentence:r.sentence,_hash:hash(r),created_at:(r.firstDay||day)+'T00:00:00Z'}));
}
export function dueCommand(store,args){
 if(!Array.isArray(args)||!['add','done','target','drop','check','state','list','today'].includes(args[0])||args.some(a=>typeof a!=='string'||a.length>20000)||args.includes('--godspeed'))throw Error('Unsupported obligation command');
 const selfCheck=args.indexOf('--self-check-arg');if(selfCheck>=0)localPath(store.root,args[selfCheck+1]||'');
 // Historical self-check paths are never allowed to inspect another installation.
 if(args[0]==='check'&&fs.existsSync(path.join(store.root,'due')))for(const file of fs.readdirSync(path.join(store.root,'due')).filter(f=>f.endsWith('.md'))){const match=fs.readFileSync(localPath(store.root,'due/'+file),'utf8').match(/^SELF-CHECK-ARG:\s*(.+)$/m);if(match)localPath(store.root,match[1]);}
 const timezone=store.get('settings','installation')?.timezone||'UTC',day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),script=fileURLToPath(new URL('../../tools/due.js',import.meta.url));
 return store.withLock(()=>{const run=spawnSync(process.execPath,[script,...args,'--godspeed',store.root],{cwd:store.root,encoding:'utf8',timeout:15000,windowsHide:true,shell:false,env:{...process.env,GODSPEED_TODAY:day}});if(run.status!==0)throw Error(String(run.stderr||run.stdout||'Obligation command failed').slice(0,500));return {result:run.stdout.trim()};});
}
export function dueDelivered(store,slugs,now=new Date()){const timezone=store.get('settings','installation')?.timezone||'UTC',day=new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(now);return store.withLock(()=>createDueCommands({root:store.root,date:day,commandArgs:[]}).recordSaid(slugs,day));}
