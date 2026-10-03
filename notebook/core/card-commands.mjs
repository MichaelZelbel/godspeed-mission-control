import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import {hash,atomic,safe} from './records/store.mjs';
const {parseCard,renderCard}=createRequire(import.meta.url)('../../tools/mc-cards.js');
import {localPath} from './local-path.mjs';
const table={goals:'goals',forecast:'forecasts',work:'work_items'};
function regularTree(root){for(const entry of fs.readdirSync(root,{withFileTypes:true})){const file=path.join(root,entry.name);if(entry.isSymbolicLink())throw Error('Personal card files must not contain symbolic links');if(entry.isDirectory())regularTree(file);}}
function boundedArguments(args){
 for(let i=0;i<args.length;i++){
  if(['--refute','--file','--moves'].includes(args[i])){
   const value=args[i+1],pattern=args[i]==='--moves'?/^notes\/[A-Za-z0-9_.-]+\.md$/:/^goals\/(?:diagnoses|playbooks)\/[A-Za-z0-9_.-]+\.md$/;if(!value||path.isAbsolute(value)||/^[A-Za-z]:|\\|(?:^|\/)\.\.(?:\/|$)/.test(value)||!pattern.test(value))throw Error('Personal card path must identify a projected goal file or note');
  }
  if(args[i]==='--date'&&!/^\d{4}-\d{2}-\d{2}$/.test(args[i+1]||''))throw Error('Personal card date must be YYYY-MM-DD');
 }
}
export function cardFor(record,kind){
 const f={...(record.legacy_fields||{}),ID:record.id},log=[...(record.legacy_log||[])];
 if(kind==='goals')Object.assign(f,{TITLE:record.title,STATUS:record.status==='active'?'adopted':record.status,KIND:record.kind||'outcome',AREA:record.area||'work-money',MEASURE:record.measure||'',LEAD:record.lead||'',DEADLINE:record.deadline||'','OWN WORDS':record.own_words||record.title,SERVES:(record.serves||[]).join(','),'DEPENDS ON':(record.depends_on||[]).join(','),PROTECTED:record.protected?'yes':'no',IMPORTANCE:record.importance||'normal'});
 if(kind==='forecast')Object.assign(f,{STATUS:record.status==='settled'?'resolved':record.status||'open',GOAL:record.goal_id||'',QUESTION:record.question||record.measure||record.title||'',P:String(record.probability??''),DEADLINE:record.check_at?.slice(0,10)||f.DEADLINE,'RESOLVES WHEN':record.resolves_when||record.measure||f['RESOLVES WHEN'],'REFERENCE CLASS':record.reference_class||f['REFERENCE CLASS']||'',EVIDENCE:record.evidence||f.EVIDENCE||'',OUTCOME:record.observed===undefined?f.OUTCOME:record.observed?'yes':'no'});
 if(kind==='work')Object.assign(f,{STATUS:({pending:'planned',awaiting_approval:'blocked',needs_review:'stale'})[record.state]||record.state,GOAL:record.goal_id||'',TITLE:record.title,'DONE WHEN':record.check||'',KIND:record.legacy_fields?.KIND||'do'});
 if(kind==='goals')for(const p of record.progress||[])log.push({date:(p.at||record.created_at).slice(0,10),event:'PROGRESS',rest:p.evidence||''});
 if(kind==='goals'&&record.last_attention)log.push({date:record.last_attention.slice(0,10),event:'ATTENTION',rest:'Integrated goal selection'});
 if(kind==='forecast'&&!log.some(l=>l.event==='MADE'))log.push({date:(record.created_at||new Date().toISOString()).slice(0,10),event:'MADE',rest:'p='+record.probability});
 return {id:record.id,f,log:[...new Map(log.map(l=>[JSON.stringify(l),l])).values()]};
}
function values(card,kind){const f=card.f;
 if(kind==='goals')return {id:f.ID,title:f.TITLE,status:f.STATUS,kind:f.KIND,area:f.AREA,measure:f.MEASURE,own_words:f['OWN WORDS'],lead:f.LEAD,deadline:f.DEADLINE,serves:(f.SERVES||'').split(',').filter(Boolean),depends_on:(f['DEPENDS ON']||'').split(',').filter(Boolean),protected:f.PROTECTED==='yes',importance:f.IMPORTANCE};
 if(kind==='forecast')return {id:f.ID,title:f.QUESTION,question:f.QUESTION,goal_id:f.GOAL,probability:f.P?Number(f.P):null,status:f.STATUS==='resolved'?'settled':f.STATUS,check_at:f.DEADLINE+'T23:59:59Z',resolves_when:f['RESOLVES WHEN'],reference_class:f['REFERENCE CLASS'],evidence:f.EVIDENCE,observed:f.OUTCOME==='yes'?true:f.OUTCOME==='no'?false:undefined};
 return {id:f.ID,title:f.TITLE,goal_id:f.GOAL,kind:'legacy-work',state:({planned:'pending',dispatched:'attempted',blocked:'awaiting_approval',stale:'needs_review'})[f.STATUS]||f.STATUS,check:f['DONE WHEN']};
}
export function importCardFiles(store,kind){
 if(!table[kind])throw Error('Choose goals, forecast or work');const folder=path.join(store.root,kind==='forecast'?'forecasts':kind);if(!fs.existsSync(folder))return {imported:0};let imported=0;
 for(const name of fs.readdirSync(folder).filter(n=>n.endsWith('.md')&&n!=='README.md')){const text=fs.readFileSync(path.join(folder,name),'utf8'),card=parseCard(text);if(!card.f.ID)continue;safe(card.f.ID);const id='legacy-'+kind+'-'+hash(name),mapping=store.get('import_mappings',id),old=store.get(table[kind],card.f.ID);if(mapping?.source_hash===hash(text))continue;
  const incoming={...values(card,kind),legacy_fields:card.f,legacy_log:card.log,legacy_source:path.relative(store.root,path.join(folder,name)).replaceAll('\\','/')};
  if(old&&(!mapping||mapping.record_hash!==old._hash))store.conflict(table[kind],incoming,old);
  const saved=store.save(table[kind],incoming,old?._hash);store.save('import_mappings',{id,source_path:incoming.legacy_source,source_hash:hash(text),record_type:table[kind],record_id:saved.id,record_hash:saved._hash});imported++;
 }return {imported};
}
export function cardCommand(store,{card,args}){
 const allowed={goals:['help','file','change','progress','read','bets','settle','question','answer','attention','diagnose','playbook','list','show','tree','check'],forecast:['help','file','revise','resolve','flag','list','due','show','score','check'],work:['help','file','list','next','show','cancel','stale','sweep','tick','check']};
 if(!allowed[card]?.includes(args?.[0])||args.some(a=>typeof a!=='string'||a.length>20000)||args.some(a=>['--godspeed','--approved-by','--approved-by-him','--check-command','--command','--runner'].includes(a)))throw Error('Unsupported personal card command');
 boundedArguments(args);
 for(const row of store.list('goals'))for(const entry of row.legacy_log||[])if(['DIAGNOSIS','REFUTED','PLAYBOOK'].includes(entry.event)&&entry.rest){const relative=entry.rest.split(/[:,]/)[0];if(!/^goals\/(?:diagnoses|playbooks)\/[A-Za-z0-9_.-]+\.md$/.test(relative))throw Error('Goal evidence must identify a projected local file');localPath(store.root,relative);}
 const staging=path.join(store.state,'card-runs',Date.now()+'-'+hash(args).slice(0,12));fs.mkdirSync(path.join(staging,'observations'),{recursive:true});
 // Project a disposable snapshot for the original command, including linked
 // goals/work/forecasts. Durable records remain the sole authority.
 const before=new Map();for(const [kind,type] of Object.entries(table)){const folder=kind==='forecast'?'forecasts':kind;fs.mkdirSync(path.join(staging,folder),{recursive:true});for(const row of store.list(type)){before.set(type+'/'+row.id,row);atomic(path.join(staging,folder,safe(row.id)+'.md'),renderCard(cardFor(row,kind),[]));}}
 for(const note of store.list('notes').filter(n=>!n.is_trashed))atomic(path.join(staging,'notes',safe(note.id)+'.md'),note.content||'');
 const supporting=new Map();for(const folder of ['diagnoses','playbooks']){const source=localPath(store.root,'goals/'+folder);if(fs.existsSync(source)){regularTree(source);for(const name of fs.readdirSync(source).filter(n=>n.endsWith('.md')))supporting.set(folder+'/'+name,hash(fs.readFileSync(path.join(source,name))));fs.cpSync(source,path.join(staging,'goals',folder),{recursive:true});}}
 const script=fileURLToPath(new URL('../../tools/'+card+'.js',import.meta.url)),run=spawnSync(process.execPath,[script,...args],{cwd:staging,encoding:'utf8',timeout:15000,windowsHide:true,shell:false,env:{...process.env,GODSPEED_ROOT:staging}});
 if(run.status!==0)throw Error(String(run.stderr||run.stdout||'Personal card command failed').slice(0,600));
 store.withLock(()=>{const changes=[];for(const [kind,type] of Object.entries(table)){const folder=kind==='forecast'?'forecasts':kind;for(const name of fs.readdirSync(path.join(staging,folder)).filter(n=>n.endsWith('.md')&&n!=='README.md')){const content=fs.readFileSync(path.join(staging,folder,name),'utf8'),c=parseCard(content);if(!c.f.ID)continue;const old=before.get(type+'/'+c.f.ID),current=store.get(type,c.f.ID);if(old&&hash(renderCard(cardFor(old,kind),[]))===hash(content))continue;if(current?._hash!==old?._hash)store.conflict(type,values(c,kind),current);changes.push(store.prepare(type,{...values(c,kind),legacy_fields:c.f,legacy_log:c.log,...(kind==='work'&&current?.kind?{kind:current.kind}:{})},current));}}
 const files=[];for(const folder of ['diagnoses','playbooks']){const src=path.join(staging,'goals',folder);if(fs.existsSync(src))for(const name of fs.readdirSync(src).filter(n=>n.endsWith('.md'))){const relative='goals/'+folder+'/'+safe(name),target=localPath(store.root,relative),content=fs.readFileSync(path.join(src,name),'utf8'),original=supporting.get(folder+'/'+name);if(hash(content)===original)continue;if((fs.existsSync(target)?hash(fs.readFileSync(target)):undefined)!==original)throw Error('Goal evidence file changed during command; retained snapshot needs review');if(original)files.push({file:'goals/history/'+hash(relative)+'-'+original+'.md',text:fs.readFileSync(target,'utf8')});files.push({file:relative,text:content});}}
 if(changes.length||files.length)store.commit(changes,{files});
 });return {result:run.stdout.trim(),retained_snapshot:path.relative(store.root,staging)};
}
export function commandWords(message){const out=[];let word='',quote=null,escape=false;for(const c of message){if(escape){word+=c;escape=false;}else if(c==='\\')escape=true;else if(quote){if(c===quote)quote=null;else word+=c;}else if(c==='"'||c==="'")quote=c;else if(/\s/.test(c)){if(word){out.push(word);word='';}}else word+=c;}if(quote||escape)throw Error('Close the command\'s quotation marks');if(word)out.push(word);return out;}
