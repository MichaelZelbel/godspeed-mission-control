// Which news a morning brief may tell, whether its pool is thin, and whether the finished brief is
// thin (#387). On 10 November 2026 a brief went out with no item to act on and one news item: its
// news window reached 7 days back, so a 5-day-old post counted as new without its date, a partly
// read pool was never widened, and nothing noticed how little was left. Pure functions only; the
// brief (briefing.mjs) reads the records and acts on the answers.
import {dayOf} from './trackers.mjs';
import {ruleRefusals} from './briefing-cut.mjs';

// Missed mornings widen the news window by one day each, up to this many.
export const MAX_GAP_DAYS=5;
// Fewer fresh news candidates than this make the pool thin, so the brief reads further sources.
export const THIN_POOL=3;

const DAY=86400000;
const MONTHS=['January','February','March','April','May','June','July','August','September','October','November','December'];
const GERMAN_MONTHS=['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/;
const dayNumber=day=>Date.UTC(+day.slice(0,4),+day.slice(5,7)-1,+day.slice(8,10))/DAY;
const addDays=(day,n)=>new Date((dayNumber(day)+n)*DAY).toISOString().slice(0,10);
const validDay=value=>typeof value==='string'&&ISO_DAY.test(value)&&addDays(value,0)===value;
export const dayLabel=day=>Number(day.slice(8,10))+' '+MONTHS[Number(day.slice(5,7))-1];

// previousBriefs: the saved briefs of earlier days, each {day, created_at}. A brief two mornings
// ago means one missed morning, so the window reaches one day further back.
export function newsWindow({previousBriefs,today}){
 const last=[...previousBriefs].filter(b=>b.day<today).sort((a,b)=>a.day.localeCompare(b.day)||String(a.created_at).localeCompare(String(b.created_at))).at(-1);
 const recovery_gap_days=last?Math.min(MAX_GAP_DAYS,Math.max(0,dayNumber(today)-dayNumber(last.day)-1)):0;
 return {search_start:addDays(today,-(2+recovery_gap_days)),recovery_gap_days,last_brief_at:last?.created_at||null};
}

// A candidate is {published, found_at}: published is the day the item says it came out (when the
// source states one), found_at when Godspeed found it. Fresh: dated inside the window. Older: dated
// before it, but found after the last brief, so no brief could have told it yet; it carries its date.
// Stale: anything else.
export function classify({published,found_at},window,today,zone){
 const found=Date.parse(found_at);
 const date=validDay(published)&&published<=today?published:Number.isFinite(found)?dayOf(new Date(found),zone):null;
 if(!date)return {state:'stale'};
 if(date>=window.search_start)return {state:'fresh'};
 if(!window.last_brief_at||found>Date.parse(window.last_brief_at))return {state:'older',published:date,age_label:'from '+dayLabel(date)};
 return {state:'stale'};
}

// Why a brief source counts as only partly read, or null when its newest read is good. lastRun is
// the topic's newest watch run (it records failed reads, which leave no observation); observation
// is the url's newest observation.
function readProblem(url,lastRun,observation){
 const entry=lastRun?.observations?.find(o=>o.url===url);
 if(entry&&(!observation||String(lastRun.observed_at)>=String(observation.observed_at))){
  if(!entry.ok)return 'could not be read';
  return observation&&observation.id===entry.id&&!String(observation.content||'').trim()?'no body':null;
 }
 if(!observation)return 'never read';
 if(!(observation.status>=200&&observation.status<300))return 'could not be read';
 return String(observation.content||'').trim()?null:'no body';
}

// The record of what the brief had to tell: topics are the sources chosen for the brief, runs and
// observations the stored reads, findings and receipts the news items the writer gets with their
// state (fresh, older, stale).
export function newsPool({window,topics,runs,observations,findings,receipts}){
 const newest=rows=>[...rows].sort((a,b)=>String(a.observed_at||a.created_at).localeCompare(String(b.observed_at||b.created_at))).at(-1);
 const read=topics.map(topic=>{
  const lastRun=newest(runs.filter(r=>r.topic_id===topic.id)),problems=[];
  for(const url of topic.urls||(topic.url?[topic.url]:[])){
   const reason=readProblem(url,lastRun,newest(observations.filter(o=>o.topic_id===topic.id&&o.url===url)));
   if(reason)problems.push({url,reason});
  }
  return {id:topic.id,title:topic.title||null,status:problems.length?'partial':'ok',problems};
 });
 const items=[...findings,...receipts],count=state=>items.filter(i=>i.state===state).length;
 return {search_start:window.search_start,recovery_gap_days:window.recovery_gap_days,status:read.some(t=>t.status==='partial')?'partial':'complete',topics:read,fresh:freshLinks({findings,receipts}).length,older_labelled:count('older'),stale_excluded:count('stale'),widened:null};
}

// The distinct links of fresh news: findings, and sources that changed meaningfully.
export function freshLinks({findings,receipts}){
 return [...new Set([...findings.filter(f=>f.state==='fresh').map(f=>f.link),...receipts.filter(r=>r.state==='fresh'&&r.changed===true).map(r=>r.url)].filter(Boolean))];
}

export const newsLink=item=>item.link||item.url;

// The date of an older news item, said where its link is, when the writer left it out. The sentence
// is English until the brief has a language setting; when the voice rules refuse it, the bare date.
export function ensureAgeLabels(text,items,voice){
 const blocks=text.split(/\n\s*\n/);
 for(const item of items){
  const link=newsLink(item),index=blocks.findIndex(b=>link&&b.includes(link));
  if(index<0||!item.published)continue;
  const block=blocks[index],[,month,day]=item.published.split('-').map(Number);
  const dayFirst=new RegExp('\\b'+day+'\\.?\\s+('+MONTHS[month-1]+'|'+GERMAN_MONTHS[month-1]+')\\b','i'),monthFirst=new RegExp('\\b'+MONTHS[month-1]+'\\s+'+day+'\\b','i');
  if(block.includes(item.published)||dayFirst.test(block)||monthFirst.test(block))continue;
  const sentence='It is from '+dayLabel(item.published)+'.',lines=block.split('\n'),at=lines.findIndex(l=>l.includes(link));
  lines[at]=lines[at].trimEnd()+(ruleRefusals(sentence,voice,{skipOpener:true}).length?' ('+item.published+')':' '+sentence);
  blocks[index]=lines.join('\n');
 }
 return blocks.join('\n\n');
}

const NUMBERED=/^\s*\d+[.)]\s+\S/m;
// A brief is thin when it gives the owner nothing to decide and fewer than two fresh news items.
export function thinCheck(text,{action_artifacts=[],watch_findings=[],source_receipts=[]}){
 const has_action=NUMBERED.test(text)||action_artifacts.some(a=>a.link&&text.includes(a.link));
 const fresh=freshLinks({findings:watch_findings.filter(f=>!f.age_label).map(f=>({...f,state:'fresh'})),receipts:source_receipts.filter(r=>!r.age_label).map(r=>({...r,state:'fresh'}))});
 const fresh_news=fresh.filter(link=>text.includes(link)).length;
 return {thin:!has_action&&fresh_news<2,has_action,fresh_news,missing_news:fresh.filter(link=>!text.includes(link)),missing_actions:action_artifacts.filter(a=>a.link&&!text.includes(a.link))};
}

// The plain reasons a thin brief gives the owner.
export function thinReasons(check,pool,{fallback=false}={}){
 const reasons=[];
 if(!check.has_action)reasons.push('nothing waits for your decision');
 if(check.fresh_news<2)reasons.push(pool.fresh<2?'only '+pool.fresh+' fresh news '+(pool.fresh===1?'item':'items')+' came in since '+dayLabel(pool.search_start):'it tells only '+check.fresh_news+' of the '+pool.fresh+' fresh news items');
 for(const topic of pool.topics.filter(t=>t.status==='partial'))reasons.push((topic.title||'a news source')+' could not be read');
 if(fallback)reasons.push('the drafts did not pass their checks');
 return reasons;
}
