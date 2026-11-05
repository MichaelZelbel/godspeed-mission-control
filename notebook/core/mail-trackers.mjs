// A TRACKER THAT COUNTS A KIND OF MAIL (4 November 2026, #215). Some numbers only arrive as mails:
// shop orders, new subscribers, booking requests, replies to job applications. A tracker's card may
// hold a mail rule, `mail: {senders, subjects, mailbox, proposal_id}`, set in the chat (the tracker
// recipe, tracker-operations.mjs `tracker-mail`), and a daily routine (scripts/mail-count.mjs, the
// routine "Mail counts") adds one entry of 1 for each matching mail, on the mail's local date.
//
// NEVER THE BODY. The only mail call here is mc-mail's headerSearch (tools/mc-mail.js): it returns
// message id, sender, subject and date, and fetches no body or attachment. AgentMail's list call also
// returns a short preview; it is received and dropped in memory before anything is returned, stored or
// logged, and is never used for matching. No sender, shop or phrase is built in: every value comes from the person's rule.
//
// An install where no tracker has a rule makes no mail call and does not even load mc-mail.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {atomic,hash} from './records/store.mjs';
import {norm,own,trackers,entries} from './trackers.mjs';
import {addDays,localParts} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// The mailboxes a rule may name: the one owner of the accepted keys, how a sentence says each, and which
// connection of the daily connection check reports it (connection-check.mjs), so a mailbox cannot be
// accepted without its failure being owned.
export const MAILBOX={gmail:{words:'your Gmail',connection:'mail'},godspeed:{words:"your mission control's own mailbox",connection:'agentmail'}};
export const MAILBOXES=Object.keys(MAILBOX);
export const FIRST_DAYS=30;
const MAX_SENDERS=10,MAX_SUBJECTS=10;
const ADDRESS=/^[^\s@<>,;"']+@[^\s@<>,;"']+\.[^\s@<>,;"']+$/,DOMAIN=/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const list=(items,and='or')=>items.length<2?items.join(''):items.slice(0,-1).join(', ')+' '+and+' '+items.at(-1);

// The rule as a person gave it, checked and normalised: lowercase senders (an address or a domain),
// subject phrases that need only one to match, and the mailbox. Anything else is refused in words.
export function mailRule(input){
 const many=(value,what)=>{if(!Array.isArray(value)||!value.length)throw Error('Name at least one '+what);return value;};
 const senders=[...new Set(many(input?.senders,'sender, an address or a domain such as shop.example.com').map(s=>String(s??'').trim().toLowerCase().replace(/^@/,'')))];
 if(senders.length>MAX_SENDERS||senders.some(s=>!(ADDRESS.test(s)||DOMAIN.test(s))))throw Error('Give up to '+MAX_SENDERS+' senders, each as an address (orders@shop.example.com) or a domain (shop.example.com)');
 const subjects=[...new Set(many(input?.subjects,'word or phrase the subject says').map(s=>String(s??'').replace(/\s+/g,' ').trim()))].filter(Boolean);
 if(!subjects.length||subjects.length>MAX_SUBJECTS||subjects.some(s=>s.length>100))throw Error('Give 1 to '+MAX_SUBJECTS+' subject phrases, each up to 100 characters; a mail counts when its subject has any of them');
 const mailbox=input?.mailbox===undefined||input.mailbox===null||input.mailbox===''?'gmail':input.mailbox;
 if(!MAILBOXES.includes(mailbox))throw Error('The mailbox is gmail (your own) or godspeed (the mission control\'s own address)');
 return {senders,subjects,mailbox};
}
// The rule on a card, or null: a hand-edited card with a broken rule counts nothing.
export function cardRule(c){try{return c?.tracker?.mail?mailRule(c.tracker.mail):null;}catch{return null;}}
export const ruleDigest=rule=>hash({senders:[...rule.senders].sort(),subjects:rule.subjects.map(norm).sort(),mailbox:rule.mailbox});
export const ruleSentence=(rule,name,isNew)=>'Count each mail from '+list(rule.senders)+' whose subject says '+list(rule.subjects.map(s=>'"'+s+'"'))+', in '+MAILBOX[rule.mailbox].words+', as one in '+(isNew?'a new tracker called ':'')+name+'?';

// Which trackers can take a rule. A daily tracker keeps one entry a day, which is not one entry per mail,
// and a tracker with other columns has nothing to put in them; a specialist keeps its own rows. Such a
// tracker is left as it is. Returns the column that gets the 1 (null for a counting tracker), or false.
export function mailColumn(c){
 if(c.tracker?.cadence!=='any'||c.tracker?.specialist)return false;
 const mine=own(c);
 if(!mine.length)return null;
 return mine.length===1&&mine[0].type==='number'?mine[0].key:false;
}
export const NOT_FITTING=name=>name+' keeps one entry a day or its own columns, and a mail count needs one entry for each mail. Say a new name and I will start a tracker for the mails.';
// Only a digest is kept: a Message-ID is written by the sender and may carry an address that is no named sender's.
export const mailId=(mailbox,id)=>mailbox+':'+hash(mailbox+'\0'+id).slice(0,32);
export const mailTrackers=store=>trackers(store).map(c=>({c,rule:cardRule(c)})).filter(t=>t.rule);
// Whether a rule counts in the mailbox that this connection of the connection check reports.
export const mailboxInUse=(store,connection)=>mailTrackers(store).some(t=>MAILBOX[t.rule.mailbox].connection===connection);
export const mailCountWanted=store=>mailTrackers(store).length>0;
const countedIds=(store,c,items)=>new Set(entries(store,c,items).map(i=>i.data?.mail_id).filter(Boolean));

// The mails of a search that match the rule's subject words, any of them, whatever the case.
export const mailMatches=(rule,messages)=>{const words=rule.subjects.map(norm);return messages.filter(m=>{const subject=norm(m.subject);return words.some(w=>subject.includes(w));});};
// The day and minute a mail is entered under, on the installation's clock; a date that cannot be read is
// not counted, and one in the future is taken as now.
export function whenOf(date,now,tz){
 const ms=Date.parse(date);if(!Number.isFinite(ms))return null;
 const p=localParts(new Date(Math.min(ms,now.getTime())),tz);return p.date+' '+p.hm;
}
// The mails from a local day on. A mailbox's "since" is a whole day in its own zone (AgentMail's is UTC),
// so the search starts a day early and the mail's local date, on the installation's clock, decides.
async function searchFrom(run,rule,from,tz){
 const found=await run({account:rule.mailbox,senders:rule.senders,after:addDays(from,-1)});
 return found.messages.filter(m=>{const ms=Date.parse(m.date);return Number.isFinite(ms)&&localParts(new Date(ms),tz).date>=from;});
}
const defaultSearch=args=>createRequire(import.meta.url)('../../tools/mc-mail.js').headerSearch(args);

// WHERE EACH RULE HAD GOT TO (machine state, like the routine records: .godspeed, never synced). A
// changed rule starts again from the last 30 days. The next window begins a day before the last
// complete one, because a mailbox's "since" counts whole days; a mail seen twice is never counted twice
// (its id is on its entry).
const stateFile=store=>path.join(store.state,'mail-counts.json');
const readState=store=>{try{const data=JSON.parse(fs.readFileSync(stateFile(store),'utf8'));return data?.rules&&typeof data.rules==='object'?data:{rules:{}};}catch{return {rules:{}};}};
export const windowFor=(state,id,rule,today)=>{const last=state.rules[id];return last?.digest===ruleDigest(rule)&&/^\d{4}-\d{2}-\d{2}$/.test(last.last_day||'')?addDays(last.last_day,-1):addDays(today,-FIRST_DAYS);};

// How many mails the rule would count over the last 30 days, not counting those the tracker has.
export async function previewCount({store,rule,c=null,search=defaultSearch,now,tz}){
 const today=localParts(now,tz).date,found=await searchFrom(search,rule,addDays(today,-FIRST_DAYS),tz);
 const have=c?countedIds(store,c,store.list('collection_items')):new Set();
 return mailMatches(rule,found).filter(m=>whenOf(m.date,now,tz)&&!have.has(mailId(rule.mailbox,m.message_id))).length;
}

// THE COUNT, once a day. Returns only numbers: nothing of a mail is kept in a result, a record or a log
// but its id on the entry it made. A search that fails (no connection, refused, the network) counts
// nothing for that rule and leaves its place where it was: the daily connection check tells the person.
export async function countMail({store,query,search,now=new Date(),tz}){
 const found=mailTrackers(store);let added=0;
 if(!found.length)return {added};
 const run=search||defaultSearch,today=localParts(now,tz).date,state=readState(store);
 for(const {c,rule} of found){
  const column=mailColumn(c);if(column===false)continue;
  let messages;
  try{messages=await searchFrom(run,rule,windowFor(state,c.id,rule,today),tz);}catch{continue;}
  // The check and the writes are one step, and a second run at the same moment waits its turn (withLockAsync),
  // so nothing is counted twice. The rule is read again inside it: one removed or changed while this run
  // waited counts nothing and leaves its place alone.
  const counted=await store.withLockAsync(()=>{
   const current=mailTrackers(store).find(t=>t.c.id===c.id);
   if(!current||ruleDigest(current.rule)!==ruleDigest(rule)||mailColumn(current.c)!==column)return false;
   const have=countedIds(store,c,store.list('collection_items'));
   for(const m of mailMatches(rule,messages)){
    const id=mailId(rule.mailbox,m.message_id),when=whenOf(m.date,now,tz);
    if(!when||have.has(id))continue;
    have.add(id);
    query.execute({table:'collection_items',operation:'insert',holdingLock:true,values:{collection_id:c.id,data:{when,[column||'value']:1,mail_id:id}}});added++;
   }
   return true;
  });
  if(counted)state.rules[c.id]={digest:ruleDigest(rule),last_day:today};
 }
 atomic(stateFile(store),JSON.stringify(state,null,2)+'\n');
 return {added};
}
