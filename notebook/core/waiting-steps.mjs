import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,hash} from './records/store.mjs';
import {appendAssistantMessage} from './conversation-state.mjs';

// ONE WAITING STEP FOR EVERY YES (issue #196): background work that needs the owner's yes opens a
// step, an `approvals` record, and the owner answers it with a plain yes or no in the chat it was
// asked in. The program finds which step a yes belongs to from these records; the model only
// phrases "which one?" and reads the owner's choice back into a step id (answerChosen).
// Each chat a step can be asked in, with the one conversation it is read from; `asked_in` and the
// matcher's route both come from this table.
export const ROUTES={telegram:{conversation:'telegram-owner',matches:id=>id==='telegram-owner'},notebook:{conversation:'notebook:general',matches:id=>/^notebook:general(:session:|$)/.test(id)}};
export const CHATS=Object.keys(ROUTES);
export const ASKER_KINDS=['routine','addon','job'];
const CHATS_FILE='waiting-step-chats.json',CLARIFICATION_MS=30*60000;
export const chatOf=conversationId=>CHATS.find(chat=>ROUTES[chat].matches(conversationId))??null;

const YES=new Set(['yes','yeah','yep','ja','jep','jo','ok','okay','sure','klar','gerne','passt','einverstanden','do it','ok do it','ok, do it','go ahead','mach','mach es','mach das','machs','approve','approved']);
const NO=new Set(['no','nope','nein','stop','stop it','stopp',"don't",'dont','cancel','lass es','lass das','lieber nicht','nicht','reject']);
const clean=words=>String(words??'').toLowerCase().replace(/[‘’]/g,"'").replace(/\s+/g,' ').trim().replace(/[\s.!?,;:]+$/u,'').replace(/^(please|bitte)[\s,]+/,'').trim();
// Anything longer or different is neither: the message then reaches the model as an ordinary one.
export const classifyAnswer=words=>{const w=clean(words);return YES.has(w)?'yes':NO.has(w)?'no':null;};

// Words that ask the owner to type something to answer (#191): `/approve`; a yes word or "reply",
// "answer" or "respond" ("with") followed by a code: a step id or other UUID, a token of six or more with a letter and a digit, six or more
// digits with no currency sign or word before or after them, or an all-letter hex word set off by
// Markdown, quotes or `#`; "reply ... code <value>"; "send/text/type (me) the code <value>";
// "enter the code <value> here / in the chat", the value bare or wrapped in Markdown or quotes (a
// full stop or other sentence mark after the value ends the sentence, so "Here is the map" is not
// "here"); "yes"/"no"/"ok" plus a code, quoted or after "reply/answer/say/type/send".
// "approve facade", "approve Q3-budget", "genehmigt 250000 Euro", "approve $25000000", a commit in
// a link, a pickup code to enter at a machine, a door code to text to someone else, "Enter the code
// 4711. Here is the map." or "Invoice no 123456" ask for nothing.
const REPLY_CODES=[/(?:^|[^\w/])\/(?:approve|reject)\b/i,
 /\b(?:approve|reject|genehmig\w*|ablehn\w*|(?:reply|answer|respond)(?:\s+with)?)[^\w\n.!?,;]{1,6}(?:(?:step-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{6,}|(?<![$€£]\s?)\d{6,}(?!\s*(?:€|\$|£|%|euro|eur|usd|dollar|chf|gbp))|(?<=[`*"'#][^\w\n]{0,5})[a-f]{6,}|[a-f]{6,}(?=[`*"']))(?![\w-])/i,
 /(?:\breply\b[^.!?\n]{0,40}?|\b(?:send|text|type)(?:\s+(?:me|us|back|in))*\s+(?:the|this|that)\s+)\b(?:code|id)\b[^\w\n.!?,;]{0,6}[\w-]*\d/i,
 /\benter\s+(?:the|this|that)\s+(?:code|id)\b[^\w\n.!?,;]{0,6}[\w-]*\d[\w-]*[`*"'“”‘’]{0,3}\s+(?:here|in\s+(?:the|this|your)\s+(?:chat|reply|answer))\b/i,
 /(?:\b(?:reply|answer|respond|say|type|send|write|text)\b[^.!?\n]{0,20}?\s|[`*"'“‘])(?:yes|no|ok|ja|nein)[^\w\n.!?,;]{1,6}(?:(?:step-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|(?=[a-z]*\d)(?=\d*[a-z])[a-z0-9]{6,}|\d{6,})(?![\w-])/i];
export const asksForCode=text=>REPLY_CODES.some(code=>code.test(text));
// A waiting step's own words stay as strict as before #191 (main's pattern, unchanged): any "/approve"; "approve", "reject" or "genehmig…" followed by
// any token holding a digit is refused, short codes included ("Reply approve 4711 to go ahead."). Refusing
// a step text only makes the assistant reword it, so this check may be stricter than the routine check.
const STEP_CODE=/\/(?:approve|reject)\b|\b(?:approve|reject|genehmig\w*)\s+\S*\d/i;
const hexCode=text=>(text.match(/[0-9a-f]{6,}/gi)||[]).some(run=>/\d/.test(run)&&/[a-f]/i.test(run));
export function checkStepText(label,text,id){
 if(typeof text!=='string'||!text.trim())throw Error('Say what the '+label+' is.');
 if(text.length>300||/[\r\n]/.test(text))throw Error('The '+label+' must be one line of at most 300 characters.');
 if(asksForCode(text)||STEP_CODE.test(text)||hexCode(text)||text.includes(id))throw Error('The '+label+' must not hold a code to type; the owner answers with a plain yes or no.');
}

export function readStep(record){
 const answered=record.status==='approved'?'yes':record.status==='rejected'?'no':null;
 return {id:record.id,status:record.status==='pending'?'waiting':answered||record.status,about:record.about||record.title||record.action||'',question:record.question||null,
  on_yes:record.on_yes||null,on_no:record.on_no||null,asked_by:record.asked_by||null,asked_in:record.asked_in||null,asked_at:record.asked_at||null,answered_at:record.answered_at||null};
}
// A step asked in a chat waits for an answer only once its question is known to have gone out (`sent_at`);
// a legacy approval has no chat and counts as it always did.
const delivered=record=>!record.asked_in||Boolean(record.sent_at);
const stepTime=record=>record.sent_at||record.asked_at||record.created_at||'';
export const waitingSteps=(store,at=new Date().toISOString())=>store.list('approvals')
 .filter(r=>r.status==='pending'&&delivered(r)&&!(r.expires_at&&r.expires_at<=at)).sort((a,b)=>stepTime(a).localeCompare(stepTime(b)));

// What the system may do by itself without asking, declared by the asking code from this fixed list.
// The model never judges it, and an outward step (sending, paying, deleting, publishing) is never on it.
export const QUIET_KINDS=['restart','reload','retry'];
const MEMORY_CHARS=100;

// The owner's latest answer about a subject. A decision has no expiry unless the owner gave one.
const decisionAbout=(store,subject,at)=>store.list('approvals')
 .filter(r=>r.subject===subject&&['approved','rejected'].includes(r.status)&&r.answered_at&&!(r.expires_at&&r.expires_at<=at))
 .sort((a,b)=>a.answered_at.localeCompare(b.answered_at)).pop()||null;
const remembered=record=>({about:record.about,user_words:record.user_words,answered_at:record.answered_at});

// Every waiting step passes three checks, in order, before anything is asked (issue #220):
//  1. `quietly` (one of QUIET_KINDS): the system does it; nothing is recorded or asked.
//  2. `subject` (a stable key the asker gives): an earlier answer about the same subject answers it.
//     A "no" is reused only while the thing is unchanged, otherwise the question says what changed.
//     A "yes" never approves an outward step: that is asked every time.
//  3. `extra` ({instruction,within}): an optional follow-up to an instruction the owner gave is done
//     when it is clearly within it and an outward step is never "within"; otherwise it is dropped.
// Returns {outcome:'quiet'|'decided'|'do'|'dropped'} with nothing asked, or {outcome:'asked',id,message}.
export function openStep(store,{about,question,yes,no,by,chat,job,quietly,subject,outward=false,extra}){
 const id='step-'+randomUUID();
 for(const [label,text] of [['reason',about],['question',question],['yes outcome',yes],['no outcome',no]])checkStepText(label,text,id);
 if(!CHATS.includes(chat))throw Error('Say where to ask: telegram or notebook.');
 const [kind,name='']=String(by||'').split(':');
 if(!ASKER_KINDS.includes(kind))throw Error('Say who asks: '+ASKER_KINDS.map(kind=>kind+':<name>').join(', ')+'.');
 if(quietly!==undefined&&!QUIET_KINDS.includes(quietly))throw Error('Quietly is one of '+QUIET_KINDS.join(', ')+'.');
 if(extra&&(typeof extra.instruction!=='string'||!extra.instruction.trim()))throw Error('Say which instruction the extra step follows.');
 if(subject!==undefined&&(typeof subject!=='string'||!subject.trim()))throw Error('Say the subject as a short key.');
 let asked=about;
 const result=store.withLock(()=>{
  const owned=job?store.get('jobs',job):null;
  if(job&&!owned)throw Error('That routine does not exist.');
  const reach=outward||Boolean(owned?.outward);
  const fingerprint=hash([about,owned?hash(owned.payload):'']);
  const at=new Date().toISOString();
  if(quietly){
   if(reach)throw Error('An outward step is never done quietly.');
   return {outcome:'quiet',quietly,about};
  }
  const earlier=subject?decisionAbout(store,subject,at):null;
  if(earlier&&(earlier.status==='rejected'||!reach)){
   const answer=earlier.status==='approved'?'yes':'no';
   if(answer==='yes'||earlier.fingerprint===fingerprint)return {outcome:'decided',answer,reply:answer==='yes'?yes:no,decision:remembered(earlier)};
   asked='You said no to "'+earlier.about.slice(0,MEMORY_CHARS)+'" before. What changed: '+about;
   checkStepText('reason',asked,id);
  }
  if(extra){
   return extra.within&&!reach?{outcome:'do',about,instruction:extra.instruction}:{outcome:'dropped',about,instruction:extra.instruction};
  }
  const record=store.prepare('approvals',{id,status:'pending',title:asked,about:asked,question,on_yes:yes,on_no:no,asked_by:{kind,name},asked_in:chat,asked_at:at,fingerprint,...(subject?{subject}:{}),...(owned?{job_id:owned.id,payload_hash:hash(owned.payload)}:{})});
  store.commit([record]);
  return {outcome:'asked'};
 });
 if(result.outcome!=='asked')return result;
 const message=asked+' '+question;
 if(chat==='notebook'){
  try{appendAssistantMessage(store,'general',message);stamp(store,id);}
  catch(error){withdrawStep(store,id);throw error;}
 }
 return {outcome:'asked',id,message};
}

// A step is answerable once the code that sent its question has said so (`sent_at`). Three senders do:
// openStep, for a question it writes into the notebook chat itself; a background delivery record that
// names the step (background-reports.mjs, via stampDelivered, together with its receipt); and the Telegram sender, for a direct
// reply it sent that holds the words of a step opened during that very turn (stampReply). The asker's
// own say-so never counts, and a question printed once certifies one step, however many ask the same words.
// The time a question or a later message reached the chat, never equal to one already recorded, so a
// message sent in the same millisecond still counts as newer (`spokeSince`).
export const deliveryClock=store=>{
 let last=0;
 for(const t of [...store.list('approvals').map(r=>r.sent_at),...store.list('conversation_messages').map(r=>r.delivered_at)])if(t)last=Math.max(last,Date.parse(t)||0);
 return new Date(Math.max(Date.now(),last+1)).toISOString();
};
// The position is taken under the writer lock that commits the record, so records ordered by lock
// are ordered by position.
export const saveReached=(store,value)=>store.withLockAsync(()=>store.saveUnderLock('conversation_messages',{...value,delivered_to:'telegram',delivered_at:deliveryClock(store)}));
// One delivery certifies every question it carries, and its receipt, in one commit: a failure leaves
// none of them answerable, never a prefix of a multi-question message. Each gets its own position.
const stampAll=(store,ids,{chat,messageId,receipt}={})=>store.withLock(()=>{
 const base=Date.parse(deliveryClock(store));let n=0;
 const changes=[],stamped=[];
 for(const id of ids){
  const record=store.get('approvals',id);
  if(record?.asked_in&&(!chat||record.asked_in===chat)&&record.status==='pending'&&!record.sent_at){
   changes.push(store.prepare('approvals',{sent_at:new Date(base+n++).toISOString(),...(messageId?{sent_message_id:messageId}:{})},record));
   stamped.push(id);
  }
 }
 const stored=receipt&&store.get('conversation_messages',receipt.id);
 if(stored)changes.push(store.prepare('conversation_messages',{delivered_at:new Date(base+n++).toISOString()},stored));
 if(changes.length)store.commit(changes);
 return stamped;
});
const stamp=(store,id)=>stampAll(store,[id]);
export const stampDelivered=(store,ids,receipt)=>{
 const stamped=stampAll(store,ids,{chat:'telegram',receipt});
 try{handOffButtons(store,stamped);}catch{}
};
// The process that delivers a report usually has no Telegram client (the notebook's own `hermes cron
// tick`), so the Yes/No buttons are sent by the gateway's godspeed-context plugin (step_buttons.py),
// which watches this folder: one file per Telegram step that has just become answerable.
export const STEP_QUESTIONS='step-questions',STEP_QUESTION_MAX_AGE_MS=24*3600000;
const STEP_ID=/^step-[0-9a-f-]{36}$/;
function handOffButtons(store,ids){
 if(!ids.length)return;
 const dir=path.join(store.state,STEP_QUESTIONS);
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 for(const name of fs.readdirSync(dir)){
  const file=path.join(dir,name);
  try{if(Date.now()-fs.statSync(file).mtimeMs>STEP_QUESTION_MAX_AGE_MS)fs.rmSync(file);}catch{}
 }
 for(const id of ids){
  const record=store.get('approvals',id);
  if(record&&STEP_ID.test(id))atomic(path.join(dir,id+'.json'),JSON.stringify({id,text:record.about+' '+record.question,expires_at:new Date(Date.now()+STEP_QUESTION_MAX_AGE_MS).toISOString()})+'\n');
 }
}
// The pending, unsent Telegram steps whose questions a routine printed in full, oldest first; a
// question printed once names one step, however many steps ask the same words.
export function stepsForWords(store,text,since=''){
 const left=new Map(),named=[];
 for(const r of store.list('approvals').filter(r=>r.status==='pending'&&r.asked_in==='telegram'&&!r.sent_at&&r.asked_at>=since).sort((a,b)=>a.asked_at.localeCompare(b.asked_at))){
  const question=r.about+' '+r.question;
  if(!left.has(question))left.set(question,String(text).split(question).length-1);
  if(left.get(question)>0){left.set(question,left.get(question)-1);named.push(r.id);}
 }
 return named;
}
export function stampReply(store,{words,since,messageId}){
 const ids=stepsForWords(store,words,since);
 if(!ids.length)return;
 const stamped=stampAll(store,ids,{messageId});
 try{handOffButtons(store,stamped);}catch{}
}
function withdrawStep(store,id){
 try{store.withLock(()=>{const record=store.get('approvals',id);if(record?.status==='pending'&&!record.sent_at)store.commit([store.prepare('approvals',{status:'withdrawn'},record)]);});}catch{}
}

// A step is answered once. A yes for a step that holds an outward job lets that job run again only
// while the job still carries the payload the owner was asked about; the scheduler checks the same
// hash before it runs anything.
export function answerStep(store,id,answer,{chat,words}){
 return store.withLock(()=>{
  const record=store.get('approvals',id);
  if(!record)throw Error('That step does not exist.');
  if(record.status!=='pending')return {already:true,step:readStep(record)};
  if(record.expires_at&&record.expires_at<=new Date().toISOString())throw Error('That step has run out.');
  const at=new Date().toISOString(),yes=answer==='yes',changes=[store.prepare('approvals',{status:yes?'approved':'rejected',answered_at:at,answered_in:chat,user_words:words,...(yes?{approved_at:at}:{})},record)];
  const job=yes&&record.job_id?store.get('jobs',record.job_id):null;
  if(job?.outward&&hash(job.payload)===record.payload_hash&&['awaiting_approval','pending'].includes(job.state))changes.push(store.prepare('jobs',{approval_id:record.id,state:'pending'},job));
  store.commit(changes);
  return {already:false,step:readStep(changes[0])};
 });
}

export function readChats(dir){try{const data=JSON.parse(fs.readFileSync(path.join(dir,CHATS_FILE),'utf8'));return data&&typeof data==='object'?data:{};}catch{return {};}}
const writeChats=(dir,chats)=>atomic(path.join(dir,CHATS_FILE),JSON.stringify(chats,null,2)+'\n');
const openClarification=(chat,at)=>{const c=chat.clarification;return c&&Date.parse(at)-Date.parse(c.at)<=CLARIFICATION_MS?c:null;};
const remember=(dir,chats,chat,at,clarification)=>writeChats(dir,{...chats,[chat]:{last_owner_at:at,...(clarification?{clarification}:{})}});
// Once an answer is committed, losing the chat note must not turn the owner's confirmation into an error.
const rememberAfterAnswer=(...args)=>{try{remember(...args);}catch{}};

// An ordinary message, with no question open, changes nothing but when the owner last wrote. That
// costs no Store, which matters because every Telegram message passes here (Hermes' hook waits seconds).
export function quietMessage(dir,{chat,words,at=new Date().toISOString()}){
 const chats=readChats(dir);
 if(classifyAnswer(words)||openClarification(chats[chat]||{},at))return false;
 remember(dir,chats,chat,at);
 return true;
}

function askContext(steps,answer){
 return '[godspeed-step] Your owner answered '+answer+' but '+steps.length+' things wait for an answer, and it is not clear which one they mean. Nothing is recorded yet. Ask them in plain words which one they mean, naming each: '+
  steps.map(s=>'"'+s.about+'"').join('; ')+'. Never show a code or an id. Do not decide for them.';
}
function chooseContext(steps,chat){
 return '[godspeed-step] You asked your owner which waiting question they meant. If this message names one of these, run `godspeed-step answer <id> --chat '+chat+'` once with that id (the program records the yes or no they gave before), then say in one plain sentence what happens. If it names none, answer it as an ordinary message. Never show an id to your owner. '+
  steps.map(s=>s.id+': '+s.about).join('; ')+'.';
}

// A bare yes answers the last thing asked: any other message delivered to the chat after the step's
// question went out (a background report that does not carry this step) is the newer one.
const spokeSince=(store,chat,step)=>store.list('conversation_messages').some(r=>r.delivered_to===chat&&r.delivered_at&&r.delivered_at>stepTime(step)&&!(r.report?.steps||[r.report?.step]).includes(step.id));

// The program matches; nothing here asks a model. `scheduled` runs answer for nobody.
// yieldTo: when a habit question was asked after a step, a plain yes belongs to that question.
export function heard(store,{chat,words,at=new Date().toISOString(),scheduled=false,yieldTo=''}){
 if(scheduled||!CHATS.includes(chat))return {kind:'none'};
 const dir=store.state,chats=readChats(dir),mine=chats[chat]||{},answer=classifyAnswer(words),clarification=openClarification(mine,at);
 const pending=new Set(waitingSteps(store,at).map(s=>s.id));
 const listed=clarification?clarification.step_ids.filter(id=>pending.has(id)):[];
 const named=ids=>ids.map(id=>readStep(store.get('approvals',id)));
 if(clarification?.state==='asked'&&listed.length&&!(answer&&listed.length>1)){
  if(answer&&listed.length===1){
   const done=answerStep(store,listed[0],answer,{chat,words});
   rememberAfterAnswer(dir,chats,chat,at);
   return {kind:'answered',step:done.step,reply:answer==='yes'?done.step.on_yes:done.step.on_no,context:answeredContext(done.step,answer)};
  }
  remember(dir,chats,chat,at,{...clarification,step_ids:listed,state:'choosing',words});
  return {kind:'choose',steps:named(listed),context:chooseContext(named(listed),chat)};
 }
 if(!answer){remember(dir,chats,chat,at);return {kind:'none'};}
 const here=waitingSteps(store,at).filter(s=>s.asked_in===chat),legacy=waitingSteps(store,at).filter(s=>!s.asked_in);
 const waiting=(here.length?here:legacy).filter(s=>!yieldTo||stepTime(s)>yieldTo);
 if(!waiting.length){remember(dir,chats,chat,at);return {kind:'none'};}
 const [only]=waiting,newerHere=store.list('approvals').some(r=>r.id!==only.id&&r.asked_in===chat&&r.status==='pending'&&delivered(r)&&stepTime(r)>stepTime(only))||spokeSince(store,chat,only);
 if(waiting.length===1&&only.asked_in===chat&&!newerHere&&!(mine.last_owner_at&&mine.last_owner_at>=stepTime(only))){
  const done=answerStep(store,only.id,answer,{chat,words});
  rememberAfterAnswer(dir,chats,chat,at);
  return {kind:'answered',step:done.step,reply:answer==='yes'?done.step.on_yes:done.step.on_no,context:answeredContext(done.step,answer)};
 }
 const steps=waiting.map(readStep);
 remember(dir,chats,chat,at,{step_ids:steps.map(s=>s.id),answer,at,state:'asked'});
 return {kind:'ask',steps,answer,context:askContext(steps,answer)};
}
const answeredContext=(step,answer)=>'[godspeed-step] Your owner answered '+answer+' to "'+step.about+'" and the program has recorded it. Confirm in one plain sentence what happens now: '+(answer==='yes'?step.on_yes:step.on_no)+' Do not ask anything else about it.';

const PRESS_WORDS={
 en:{yes:'Yes',no:'No',already:answer=>'This was already answered ('+answer+'). Nothing changed.',closed:'This question is no longer open. Nothing changed.'}};

// A press on the Yes or No button under one step's own message (godspeed-context's step_buttons.py).
// It answers that step id and no other, once, exactly as a typed answer does (answerStep); a step
// that is not a sent Telegram question has no button to press.
export function pressStep(store,{id,answer,scheduled=false,at=new Date().toISOString()}){
 if(scheduled)throw Error('A scheduled run cannot answer for your owner.');
 if(answer!=='yes'&&answer!=='no')throw Error('Say yes or no.');
 const record=store.get('approvals',id);
 if(!record||record.asked_in!=='telegram'||!record.sent_at)throw Error('That button belongs to no question it can answer.');
 const words=PRESS_WORDS.en,text=record.about+' '+record.question+'\n\n';
 const unchanged=(status,step)=>({changed:false,step,reply:text+(status==='approved'||status==='rejected'?words.already(status==='approved'?'yes':'no'):words.closed)});
 if(record.status!=='pending'||(record.expires_at&&record.expires_at<=at))return unchanged(record.status,readStep(record));
 const done=answerStep(store,id,answer,{chat:'telegram',words:'(button)'});
 if(done.already)return unchanged(store.get('approvals',id).status,done.step);
 return {changed:true,step:done.step,reply:text+words[answer]+': '+(answer==='yes'?done.step.on_yes:done.step.on_no)};
}

// The model's read-back after "which one?": only the step id comes from the model. The yes or no is
// the one the owner gave, and only a step the open question listed, in the turn that answered it.
export function answerChosen(store,{chat,id,scheduled=false,at=new Date().toISOString()}){
 if(scheduled)throw Error('A scheduled run cannot answer for your owner.');
 const dir=store.state,chats=readChats(dir),mine=chats[chat]||{},clarification=mine.clarification;
 if(!clarification||clarification.state!=='choosing'||!openClarification(mine,at)||!clarification.step_ids.includes(id))throw Error('Your owner has not just chosen that question.');
 const done=answerStep(store,id,clarification.answer,{chat,words:clarification.words});
 try{writeChats(dir,{...chats,[chat]:{last_owner_at:mine.last_owner_at}});}catch{}
 return done;
}
