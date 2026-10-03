import {hash,safe} from './records/store.mjs';
import {visibleRows} from './visibility.mjs';
const cadence={daily:1440,weekly:10080,fortnightly:20160,monthly:43200,quarterly:131040,yearly:525600};
const line=(value,name)=>{if(typeof value!=='string'||!value.trim()||/[\r\n]/.test(value)||value.length>4000)throw Error(name+' needs one nonempty line');return value.trim();};
const date=(value,name)=>{if(!Number.isFinite(Date.parse(value)))throw Error(name+' needs a real date');return new Date(value).toISOString();};
function argumentsFor(args){const positional=[],flags={};for(let i=0;i<args.length;i++){const arg=args[i];if(arg.startsWith('--')){const name=arg.slice(2);if(Object.hasOwn(flags,name))throw Error('Repeated option '+name);flags[name]=args[i+1]&&!args[i+1].startsWith('--')?args[++i]:true;}else positional.push(arg);}return {positional,flags};}
export function watchCommand({store,query},args){
 if(!Array.isArray(args)||args.some(a=>typeof a!=='string'||a.length>10000))throw Error('Choose a supported watch command');
 const [command='help',...tail]=args,{positional,flags}=argumentsFor(tail),rows=visibleRows(query,'watch_topics'),now=Date.now();
 const find=()=>{const id=safe(positional[0]||''),topic=rows.find(t=>t.id===id||t.slug===id);if(!topic)throw Error('Watch topic missing');return topic;};
 const result=value=>({result:typeof value==='string'?value:JSON.stringify(value,null,2)});
 if(['help','-h','--help'].includes(command))return result('mc-watch add SLUG --title TITLE --shape comparison|source-watch --cadence daily|weekly|monthly|quarterly|yearly --better ANSWER --authority ANSWER --tell-me-when ANSWER --url HTTPS\nmc-watch list|due|show SLUG|log SLUG WORDS\nmc-watch candidate SLUG --name NAME --json JSON\nmc-watch file SLUG --score 40..100 --what WORDS --if-ignored WORDS --next WORDS --link HTTPS --expires DATE\nmc-watch queue|pull --channel brief|notebook --limit 1|2 [--dry-run]|expire|check');
 if(command==='list')return result(rows);
 if(command==='due')return result(rows.filter(t=>!t.paused&&(!t.next_run_at||Date.parse(t.next_run_at)<=now)).map(t=>t.slug||t.id).join('\n'));
 if(command==='show'){const topic=find();return result({...topic,candidates:visibleRows(query,'watch_candidates').filter(c=>c.topic_id===topic.id),runs:visibleRows(query,'watch_runs').filter(r=>r.topic_id===topic.id).slice(-10)});}
 if(command==='add'){
  const slug=safe(positional[0]||'');if(rows.some(t=>t.slug===slug||t.id===slug))throw Error('Watch topic already exists');
  const shape=flags.shape;if(!['comparison','source-watch'].includes(shape))throw Error('Choose comparison or source-watch');
  const minutes=cadence[flags.cadence];if(!minutes)throw Error('Choose a supported cadence');
  const url=new URL(line(flags.url,'Source address'));if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('Use an HTTPS source or an isolated local test source');
  const data={slug,title:line(flags.title,'Title'),shape,better:line(flags.better,'Better means'),authority:line(flags.authority,'Authority'),criteria:line(flags['tell-me-when'],'Tell me when'),cadence_minutes:minutes,urls:[url.href],paused:false};
  return result(addWatchTopic(store,data));
 }
 if(command==='log'){const topic=find(),text=line(positional.slice(1).join(' '),'Run evidence'),at=new Date().toISOString();return result(store.withLock(()=>{const run=store.prepare('watch_runs',{topic_id:topic.id,content:text,observed_at:at}),current=store.get('watch_topics',topic.id);store.commit([run,store.prepare('watch_topics',{last_run_at:at,next_run_at:new Date(now+current.cadence_minutes*60000).toISOString()},current)]);return run;}));}
 if(command==='candidate'){
  const topic=find(),name=line(flags.name,'Candidate name');let data;try{data=JSON.parse(flags.json);}catch{throw Error('Candidate needs JSON facts and a verdict');}
  if(!['tested','the API has the field','their docs claim','a user said'].includes(data.how_we_know))throw Error('Choose an evidence grade');
  const checked=date(data.checked,'Checked'),recheck=date(data.recheck_after,'Recheck after');if(Date.parse(checked)>now||Date.parse(recheck)<=Date.parse(checked))throw Error('Evidence needs a past check and a later recheck');
  if(!Array.isArray(data.facts)||!data.facts.length||data.facts.some(f=>!f.requirement||!f.evidence||!f.url))throw Error('Each fact needs its requirement, evidence and source URL');
  for(const fact of data.facts){line(fact.requirement,'Requirement');line(fact.evidence,'Evidence');if(new URL(fact.url).protocol!=='https:')throw Error('Candidate facts need HTTPS source URLs');}
  const id='watch-candidate-'+hash([topic.id,name]);return result(store.save('watch_candidates',{id,topic_id:topic.id,name,...data,checked,recheck_after:recheck}));
 }
 if(command==='file'){
  const topic=find(),score=Number(flags.score);if(!Number.isInteger(score)||score<40||score>100)throw Error('Only findings scoring 40 to 100 enter the queue');
  const what=line(flags.what,'What changed'),consequence=line(flags['if-ignored'],'Consequence'),next=line(flags.next,'Next step'),link=new URL(line(flags.link,'Source link'));if(link.protocol!=='https:'&&!(link.protocol==='http:'&&['localhost','127.0.0.1'].includes(link.hostname)))throw Error('A finding needs its verified source link');
  const expires=date(flags.expires,'Expiry');if(Date.parse(expires)<=now)throw Error('A finding must expire in the future');
  const id='watch-finding-'+hash([topic.id,what,link.href]),existing=store.get('watch_findings',id);if(existing)return result(existing);
  return result(store.save('watch_findings',{id,topic_id:topic.id,score,what,consequence,next,link:link.href,expires,status:'pending',verdict:null}));
 }
 if(['queue','pull','expire','check'].includes(command)){
  const findings=visibleRows(query,'watch_findings'),live=findings.filter(f=>f.status==='pending'&&Date.parse(f.expires)>now).sort((a,b)=>b.score-a.score||a.created_at.localeCompare(b.created_at));
  if(command==='queue')return result(live);
  if(command==='expire'){const expired=findings.filter(f=>f.status==='pending'&&Date.parse(f.expires)<=now);store.withLock(()=>store.commit(expired.map(f=>store.prepare('watch_findings',{status:'expired'},f))));return result({expired:expired.length});}
  if(command==='check')return result({never_run:rows.filter(t=>!t.last_run_at).map(t=>t.id),overdue:rows.filter(t=>!t.paused&&Date.parse(t.next_run_at)<now-86400000).map(t=>t.id),blind_topics:rows.filter(t=>t.blind_runs>=3).map(t=>t.id),expired_verdicts:visibleRows(query,'watch_candidates').filter(c=>Date.parse(c.recheck_after)<=now).map(c=>c.id)});
  const channel=flags.channel,limit=Number(flags.limit||1),cap=channel==='brief'?1:channel==='notebook'?2:0;if(!cap||!Number.isInteger(limit)||limit<1||limit>cap)throw Error('Brief takes at most one; notebook takes at most two');
  const selected=live.slice(0,limit);if(!flags['dry-run'])store.withLock(()=>store.commit(selected.map(f=>store.prepare('watch_findings',{status:'shown',shown_at:new Date().toISOString(),channel},f))));return result(selected);
 }
 throw Error('Choose a supported watch command; use help');
}
export function addWatchTopic(store,data){return store.withLock(()=>{const topic=store.prepare('watch_topics',data),owner=store.get('settings','installation')?.owner||store.device,existing=store.get('jobs','watch-sweeper'),records=[topic];if(!existing)records.push(store.prepare('jobs',{id:'watch-sweeper',kind:'watch',owner,paused:false,next_run:new Date().toISOString(),interval_ms:60000,state:'pending'}));store.commit(records);return topic;});}
