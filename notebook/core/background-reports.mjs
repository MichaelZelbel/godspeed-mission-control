import fs from 'node:fs';
import path from 'node:path';
import {hash} from './records/store.mjs';
import {keepAiFailure,KEPT_FILE} from './ai-failures.mjs';
import {ruleRefusals} from './briefing-cut.mjs';
import {queueNotice} from './notices.mjs';
import {deliveryFor} from './notebook-routines.mjs';
import {telegramInHermes} from './starting-routines.mjs';
import {stampDelivered,stepsForWords} from './waiting-steps.mjs';

// BACKGROUND WORK TELLS THE OWNER IN THE CHAT'S VOICE, AND THE CHAT KNOWS IT (4 November 2026, #198).
//
// A routine delivered by Hermes reaches the owner's Telegram in the words its script printed, and
// Hermes does not put such a message into the chat's history, so "what is this about?" reached an
// assistant that had never seen it. Now every message background work sends is recorded as a
// conversation_messages record (the notebook's own Telegram chat reads them from there, and the
// godspeed-context plugin lists the last few before each reply), and a notice handed over as facts
// is written with the guidance the chat itself reads: SOUL.md, AGENTS.md and profile/voice.md.
// A briefing or a talk is only recorded, never rewritten. With no AI, or words the code refuses,
// the notice's own plain text goes out and is recorded.

const GUIDANCE_CHARS=20000,REPORT_CHARS=4000;
export const REPORT_CONTRACT="Write the message you send your owner in your chat with them about what happened below. guidance is what you read before every reply in that chat: write exactly as you write there, in your own voice. Say what it is about from zero, in everyday words, about one thing, and end with the one plain step it needs from them, or none. Use only the facts given. Never put an id, a code or a command in it, and never ask them to type one. If the facts are about more than one thing, write one report for each. Return JSON {reports:[{about,text}]}.";
export const REPORT_PREFIX='background-report-';
// Words that ask the owner to type something to answer: `approve 59f1d506`, `/approve`, "send the
// code 336d5142". Saying "approve of" or a commit's hex in a link asks for nothing.
const REPLY_CODES=[/(?:^|[\s`"'“‘(])\/(?:approve|reject)\b/i,/\b(?:approve|reject)\s+[`"'“‘]?(?=[\w-]*\d)(?:(?=[\w-]*[a-z])[\w-]{4,}|\d{6,})/i,
 /\b(?:reply|send|type|enter|text)\b[^.!?\n]{0,40}?\b(?:code|id)\s*[:#]?\s*[`"'“‘]?[\w-]*\d/i];
export const asksForCode=text=>REPLY_CODES.some(code=>code.test(text));

const readText=file=>{try{return fs.readFileSync(file,'utf8').slice(0,GUIDANCE_CHARS);}catch{return null;}};

// What the chat reads before it answers, each as it is read there.
export function chatGuidance({root,home}){
 return {who_it_is:readText(path.join(home,'SOUL.md')),manual:readText(path.join(root,'AGENTS.md')),voice:readText(path.join(root,'profile','voice.md'))};
}

function parseReports(raw){
 const data=typeof raw==='string'?JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g,'')):raw;
 if(!Array.isArray(data?.reports)||!data.reports.length)throw Error('no reports');
 return data.reports.map(r=>({about:String(r?.about||'').trim(),text:String(r?.text||'').trim()}));
}

function refused(text,{step,voice}){
 return !text||text.length>REPORT_CHARS||ruleRefusals(text,voice).length>0||asksForCode(text)||(step&&text.includes(step));
}

// The words for a hand-over: {reports:[{about,text}], written:'assistant'|'fallback'}. Anything that
// goes wrong with the AI gives the notice's own text, one report.
export async function writeReport(handover,{provider=null,guidance={}}={}){
 const fallback={reports:[{about:handover.about||'',text:handover.text}],written:'fallback'};
 if(handover.written===true)return {reports:[{about:handover.about||'',text:handover.text}],written:'assistant'};
 if(!provider)return fallback;
 try{
  const reports=parseReports(await provider({kind:'background-report',guidance,handover:{about:handover.about||'',facts:handover.facts||[handover.text],step:handover.step||null},timeout_ms:300000,contract:REPORT_CONTRACT}));
  if(reports.some(r=>refused(r.text,{step:handover.step,voice:guidance.voice})))return fallback;
  return {reports:reports.map(r=>({about:r.about||handover.about||'',text:r.text})),written:'assistant'};
 }catch{return fallback;}
}

export const reportDelivery=(store,home)=>deliveryFor(store.get('settings','installation'),{telegram:telegramInHermes(home)});

const stamp=at=>at.toISOString().replace(/[-:]/g,'').replace(/\.\d+Z$/,'Z');

const reportValue=({text,about='',facts=[],steps=[],routine=null,written,delivery,at=new Date()})=>{
 const telegram=delivery==='telegram';
 return {id:REPORT_PREFIX+stamp(at)+'-'+hash([text,about,at.toISOString(),delivery]).slice(0,8),role:'assistant',content:text,source_app:'background',conversation_id:telegram?'telegram-owner':null,delivered_to:telegram?'telegram':'notebook',sent_at:at.toISOString(),report:{about,facts,steps,routine,written}};
};

// One conversation_messages record for a message handed to delivery; resolves to the record, whose
// id is the receipt of its delivery. A report that names waiting steps is their questions on their
// way, not yet sent: `delivered` makes them answerable once Hermes reports success.
export const recordReport=(store,message)=>store.saveAsync('conversation_messages',reportValue(message));

// Called only after Hermes delivered `words` to the owner. `receipts` are the ids of the delivery
// records the caller recorded for this delivery; a caller that did not record them (a routine
// script recorded its own words earlier) gets the oldest Telegram record of exactly those words
// not yet delivered. A receipt is used once, and certifies the complete step set its record names.
// Returns the ids of the receipts used; none when nothing matched.
export function delivered(store,words,receipts=[]){
 const open=r=>r.delivered_to==='telegram'&&!r.delivered_at;
 const found=receipts.length?receipts.map(id=>store.get('conversation_messages',id)).filter(r=>r&&open(r))
  :store.list('conversation_messages').filter(r=>open(r)&&r.content===words).sort((a,b)=>a.sent_at.localeCompare(b.sent_at)).slice(0,1);
 for(const record of found){
  // `step` is the scalar a record persisted before the set `steps` existed.
  stampDelivered(store,record.report?.steps||[record.report?.step].filter(Boolean),record);
 }
 return found.map(r=>r.id);
}

// The words to say for a fresh notice. Reports a writing split off wait as notices of their own.
export async function sayNotice(store,{notice,home,provider=null,guidance}){
 const written=await writeReport(notice,{provider,guidance:guidance||chatGuidance({root:store.root,home})});
 const [first,...rest]=written.reports;
 rest.forEach((r,i)=>queueNotice(store,{id:`${notice.id}~${i+2}`,text:r.text,about:r.about,facts:notice.facts,step:notice.step,written:true}));
 await recordReport(store,{text:first.text,about:first.about,facts:notice.facts||[notice.text],steps:notice.step?[notice.step]:[],routine:'notice',written:written.written,delivery:reportDelivery(store,home)});
 return {text:first.text};
}

// A routine's own words, recorded as they were printed. A job made in Settings delivers where its
// own job says, which the Hermes hook passes as delivery. A list of deliveries is recorded together
// or not at all. Resolves (a list: returns) to the ids of the records, the receipts of their delivery.
// Words that ask the owner to type a code to answer are refused, not recorded (#191): every caller
// sends only what was recorded, so the refusal keeps them out of the chat, and the routine's run
// keeps the reason. A yes is asked for with a waiting step (godspeed-step open), answered in words.
export const ASKS_FOR_CODE='Not sent: these words ask your owner to type a code to answer. Ask for a yes with godspeed-step open, which they answer with a plain yes or no.';
export function recordRoutine(store,{routine,text,home,delivery}){
 if(asksForCode(text))throw Error(ASKS_FOR_CODE);
 const steps=stepsForWords(store,text);
 const message=d=>({text,about:routine,routine,steps,written:'routine',delivery:d});
 if(!Array.isArray(delivery))return recordReport(store,message(delivery||reportDelivery(store,home))).then(r=>[r.id]);
 const values=delivery.map(d=>reportValue(message(d)));
 store.transaction(view=>view.commit(values.map(v=>store.prepare('conversation_messages',v))));
 return values.map(v=>v.id);
}

// A SCHEDULED FOLLOW-UP THAT FAILED (11 November 2026, #385). Hermes delivered its own failure note to
// the owner's Telegram word for word: a job name, a Python error, a command to run and a path. Now
// the Hermes hook hands such a failure here instead. The note is kept in the notebook's failure log,
// never in the chat. The first failure of a one-time follow-up is said in one plain sentence about
// what it was for, written by the notebook's AI; without an AI, or with words that still read like
// the note, nothing is said. A follow-up whose retries are used up is left for repair with a
// notification in the notebook. It names what the follow-up was for in a few everyday words the AI
// wrote from its prompt, never the job's name or id (the name Hermes shows is the AI's own label for
// the job, like `kofi-pricing-revisit-20261110`), and tells the owner they can ask for it again in
// the chat, where the link goes. The failure log is for repair, not for the owner, so it is not named.
export const FOLLOW_UP_CONTRACT="Write one sentence for your owner, in your own voice as in your chat with them, about the follow-up described in the facts: what it was meant to do, in everyday words, that it could not run because something broke on your side, and when you will try again. Use only the facts given. Never name a job, a program, an error, a command or a file. Return JSON {reports:[{about,text}]} with exactly one report.";
export const GIVEN_UP_CONTRACT="Name the follow-up described in the facts for your owner in a few everyday words, as the object of a sentence like 'I could not do ...': what it was meant to do, at most a dozen words, no full stop. Use only the facts given. Never name a job, a program, an error, a command or a file. Return JSON {reports:[{about,text}]} with exactly one report, its text the words.";
const SUBJECT_CHARS=120,FOLLOW_UP_CHARS=300,PROMPT_CHARS=600,WRITING_MS=60000;
const TECHNICAL=/\b(?:hermes|cron|traceback|exception|error|godspeed sync)\b/i,A_PATH=/[~\/][\w.-]+\/[\w.-]/;

export function unsafeFollowUpText(text,job){
 const lower=text.toLowerCase(),names=[job?.id,job?.name].filter(n=>typeof n==='string'&&n.trim()).map(n=>n.toLowerCase());
 return text.length>FOLLOW_UP_CHARS||text.includes('`')||A_PATH.test(text)||TECHNICAL.test(text)||names.some(n=>lower.includes(n));
}

export async function followUpFailed(store,{job={},origin,attempt,one_time,retry_at,given_up,retry_error,note,home,provider=null,guidance,now=new Date()}){
 origin=String(origin||job.id||'');
 if(!keepAiFailure({file:path.join(store.state,KEPT_FILE),diagnostic:note,said:'',now,extra:{scheduled_job:job.id,name:job.name,origin,attempt,...(retry_error?{retry_error}:{})}}))throw Error('the failure log could not be written');
 let told=false;
 if(one_time&&attempt===1&&!given_up&&provider){
  const about='a follow-up you asked for';
  const facts=['What the follow-up was asked to do: '+String(job.prompt||'').slice(0,PROMPT_CHARS),'It could not run because something broke on the assistant\'s side.',retry_at?'It will be tried again at '+retry_at+'.':'It will be tried again later.'];
  const text=await writeOne({store,job,origin,facts,contract:FOLLOW_UP_CONTRACT,home,provider,guidance});
  if(text)told=queueNotice(store,{id:'follow-up-failed-'+origin,text,about,facts,written:true});
 }
 if(given_up){
  const what=provider&&job.prompt?await writeOne({store,job,origin,facts:['What the follow-up was asked to do: '+String(job.prompt).slice(0,PROMPT_CHARS)],contract:GIVEN_UP_CONTRACT,home,provider,guidance}):'';
  const subject=what&&what.length<=SUBJECT_CHARS&&!/[\n"]/.test(what)?what.replace(/[.!\s]+$/,''):'';
  const tries=`${attempt} ${attempt===1?'time':'times'}`;
  await store.saveAsync('notifications',{id:'follow-up-given-up-'+origin,status:'pending',kind:'follow-up-given-up',title:'A follow-up could not be done',
   body:(subject?`I could not do a follow-up you asked for in the chat: ${subject}. `:'A follow-up you asked for in the chat could not be done. ')+`It was tried ${tries} and will not be tried again. You can ask for it again in the chat.`,link:'/dashboard/chat',failed_at:now.toISOString()},undefined,{timeoutMs:30000});
 }
 return {told,given_up:!!given_up};
}

// One text from the notebook's AI about a follow-up, bounded in time; '' when no AI wrote exactly one
// that is free of the job's name and id, the first job's id, and anything technical.
async function writeOne({store,job,origin,facts,contract,home,provider,guidance}){
 const bounded=input=>provider({...input,contract,signal:AbortSignal.timeout(WRITING_MS)});
 const written=await writeReport({about:'a follow-up you asked for',facts,text:''},{provider:bounded,guidance:guidance||chatGuidance({root:store.root,home})});
 const [report,...more]=written.reports,text=report?.text||'';
 return written.written==='assistant'&&!more.length&&text&&!unsafeFollowUpText(text,job)&&!(origin&&text.toLowerCase().includes(origin.toLowerCase()))?text:'';
}
