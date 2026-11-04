import fs from 'node:fs';
import path from 'node:path';
import {hash} from './records/store.mjs';
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
const CODE_REPLY=/\b(?:approve|reject)\s+[0-9a-f]{6,}\b/i;

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
 return !text||text.length>REPORT_CHARS||ruleRefusals(text,voice).length>0||CODE_REPLY.test(text)||(step&&text.includes(step));
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
  for(const id of record.report?.steps||[record.report?.step].filter(Boolean))stampDelivered(store,id,'telegram');
  store.commit([store.prepare('conversation_messages',{delivered_at:new Date().toISOString()},record)]);
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
export function recordRoutine(store,{routine,text,home,delivery}){
 const steps=stepsForWords(store,text);
 const message=d=>({text,about:routine,routine,steps,written:'routine',delivery:d});
 if(!Array.isArray(delivery))return recordReport(store,message(delivery||reportDelivery(store,home))).then(r=>[r.id]);
 const values=delivery.map(d=>reportValue(message(d)));
 store.transaction(view=>view.commit(values.map(v=>store.prepare('conversation_messages',v))));
 return values.map(v=>v.id);
}
