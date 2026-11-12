// THE WORK A MORNING BRIEF REPORTS AS DONE (11 November 2026, #377).
//
// The first-day scenario's brief told the person their emergency-kit checklist "has a first draft"
// and never named the work Godspeed had finished and checked, so a reader could not tell which work
// was done. The owner's decision (PR #449): when the brief reports finished work, it names that work
// plainly by its title, without file paths or internal names. The briefing (core/briefing.mjs) puts
// the line this module writes into the note itself, the way it puts the health summary lines, so a
// model draft that tells the work in its own words still names it.

const day=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):null;

// A work title as a person reads it: a work card's title often says where its file goes ("... at
// work/emergency-kit-checklist.md"); that place, any other file path, inline code and a card ID are
// machinery, not the work.
export function plainTitle(title){
 if(typeof title!=='string')return null;
 const plain=title
  .replace(/`([^`]*[\\/][^`]*)`/g,'$1')
  .replace(/`[^`]*`/g,' ')
  .replace(/\s+(?:at|in|into|to|under|as|from)\s+(?=\S*[\\/])\S*?(?=[,;:.!?)]*(?:\s|$))/gi,'')
  .replace(/(?:^|\s)\S*[\\/]\S*\.[A-Za-z0-9]+(?=$|[\s,;:.!?)])/g,' ')
  .replace(/\bW-\d+[A-Za-z0-9._-]*/g,' ')
  .replace(/\s+/g,' ').trim().replace(/[\s,;:.]+$/,'');
 return plain&&!/[\r\n\u0000-\u001f]/.test(plain)&&plain.length<=480?plain:null;
}

// When the work's check passed: the notebook's own verification, or the VERIFIED line of the work
// card the daily round keeps (a day, since a card's log is dated by day).
export function verifiedAt(row){
 const at=row?.verification?.at||row?.verified_at;
 if(typeof at==='string'&&Number.isFinite(Date.parse(at)))return at;
 const log=Array.isArray(row?.legacy_log)?row.legacy_log:[];
 for(let i=log.length-1;i>=0;i--)if(log[i]?.event==='VERIFIED'&&day(log[i].date))return day(log[i].date);
 return null;
}

// Research (a work card of KIND learn) is how Godspeed got to the result, not the result: its title is a
// question, often with what was read in brackets. When the same days also finished work the person
// gets (a checklist, a draft), the line names that work only, so it reads plainly (scenarios run
// 43107490873 named a research question and a draft's full brief in one 450-character line).
const research=row=>String(row?.legacy_fields?.KIND||row?.work_kind||'').trim().toLowerCase()==='learn';

// The work verified since the last briefing (or, before the first, today and yesterday), newest
// first, that the last briefing did not already name, as titles a person reads.
export function finishedWork(rows,{previous=null,today,dayOf}={}){
 const since=previous?.created_at&&Number.isFinite(Date.parse(previous.created_at))?previous.created_at:null;
 const sinceDay=since?dayOf(new Date(since)):day(new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString());
 const told=String(previous?.content||'').toLowerCase();
 const fresh=at=>at.length===10?at>=sinceDay:since?Date.parse(at)>Date.parse(since):at.slice(0,10)>=sinceDay;
 const titles=[];
 for(const row of [...(rows||[])].filter(row=>row?.state==='verified'&&row.kind!=='repair').map(row=>({row,at:verifiedAt(row)})).filter(x=>x.at&&fresh(x.at)).sort((a,b)=>b.at.localeCompare(a.at))){
  const title=plainTitle(row.row.title)||plainTitle(row.row.legacy_fields?.WHAT);
  if(title&&!told.includes(title.toLowerCase())&&!titles.some(t=>t.title.toLowerCase()===title.toLowerCase()))titles.push({title,research:research(row.row)});
 }
 const results=titles.filter(t=>!t.research);
 return (results.length?results:titles).slice(0,3).map(t=>t.title);
}

// The verbs a "Next:" line may open with: an action the person can do today, for any goal ("Next:
// walk 20 minutes after lunch.", "Next: email the landlord about the lease.", "Next: open the
// checklist and fill in who lives with you."). The owner's decision on PR #449 (12 November 2026):
// this is only a request. When the first draft's "Next:" line opens with some other word, the writer
// is asked once to start it with an action, and whatever comes back is kept; a brief is never
// discarded or replaced because of its verb. The first-day scenario accepts the same verbs
// (scenarios/first-day.sh, actionVerbs).
export const NEXT_VERBS=Object.freeze(['add','answer','arrange','ask','book','bring','buy','call','cancel','check','choose','clean','clear','collect','complete','confirm','cook','count','create','decide','download','drink','drop','eat','email','fill','find','finish','fix','follow','gather','get','give','go','install','invite','join','keep','label','list','look','make','mark','measure','meet','message','move','note','open','order','organize','pack','pay','phone','pick','plan','practice','practise','prepare','print','put','read','record','renew','reply','replace','return','review','ring','run','save','schedule','send','set','share','sign','sort','start','stop','store','stretch','take','talk','tell','test','text','tick','try','update','visit','walk','wash','watch','water','write']);
const NEXT_FILLER=new Set(['a','an','and','at','for','in','it','more','next','now','on','the','this','that','them','to','today','with','your']);

// Null when every "Next:" line in the note opens with an action verb and says what it acts on,
// otherwise the request the writer gets for its one rewrite. A note without a "Next:" line, and a
// "Today:" line (often the weather or the day's plan, not an action), are not asked about here.
export function nextLineError(text){
 for(const line of String(text||'').split(/\r?\n/).map(line=>line.replace(/[*_`]/g,'').trim())){
  const head=line.match(/^next(?:\s+(?:today|step|action))?\s*:\s*(.*)$/i);
  if(!head)continue;
  const words=head[1].toLowerCase().match(/[a-z]+/g)||[];
  if(!NEXT_VERBS.includes(words[0])||!words.slice(1).some(word=>!NEXT_FILLER.has(word)))return 'Start the "Next:" line with an action the person can do, followed by what it acts on (for example "Next: walk 20 minutes after lunch." or "Next: email the landlord about the lease.")';
 }
 return null;
}

// The one line the brief carries for them, or null when nothing was finished.
export function finishedLine(titles){
 if(!titles?.length)return null;
 const line='Finished and checked: '+titles.join('; ');
 return /[.?!]$/.test(line)?line:line+'.';
}
