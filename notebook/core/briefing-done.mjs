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
  if(title&&!told.includes(title.toLowerCase())&&!titles.some(t=>t.toLowerCase()===title.toLowerCase()))titles.push(title);
 }
 return titles.slice(0,3);
}

// The one line the brief carries for them, or null when nothing was finished.
export function finishedLine(titles){
 if(!titles?.length)return null;
 const line='Finished and checked: '+titles.join('; ');
 return /[.?!]$/.test(line)?line:line+'.';
}
