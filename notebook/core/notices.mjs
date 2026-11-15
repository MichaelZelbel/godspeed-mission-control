import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';

// WHAT THE NOTEBOOK MUST TELL THE PERSON AND CANNOT SEND ITSELF (18 October 2026), such as a nightly
// backup that failed. With the original assistant only Hermes sends anything, so the notebook queues
// such a notice here, in this machine's own state, and the two routines that run every 15 minutes
// (the coach's reminders and the journal's check-ins, routine-scripts/godspeed_routines.py notices)
// say each one once, where the routines' results go: Telegram, or a note in "From your routines".
// The notebook's bell shows it too (a notifications record), for a machine with neither routine.
// The unattended Git helper (tools/unattended-git.cjs) queues a git-sign-in-<day> notice when this computer's GitHub sign-in is missing.
//
// A notice is a hand-over of facts (4 November 2026, #198): what it is about, the facts, and the
// waiting step's id if one waits. The routine hands it to core/background-reports.mjs, which writes
// the words with the chat's own guidance and records them where the chat reads them. `text` stays
// the plain words said when no AI can write them. `written` marks a report already written (a
// second report a writing split off), which is said as it is.
//
// A notice carries `not_sent:{reason,at}` when it was queued before the notice sender first started on a
// mission control not made from the starter (4 November 2026, #225): it is kept and never said.
export const NOTICES_FILE='notices.json';
export const NOT_SENT_BEFORE_SENDER='Queued before Godspeed began sending notices on this machine, so it was kept and not sent.';
const KEEP=50;
export function readNotices(store){try{const data=JSON.parse(fs.readFileSync(path.join(store.state,NOTICES_FILE),'utf8'));return Array.isArray(data?.notices)?data.notices:[];}catch{return [];}}
export function queueNotice(store,{id,text,at=new Date().toISOString(),about,facts,step,written}){
 if(typeof id!=='string'||!id||typeof text!=='string'||!text.trim())throw Error('A notice needs an id and its words');
 const notices=readNotices(store);if(notices.some(n=>n.id===id))return false;
 const entry={id,text:text.trim(),at,about:typeof about==='string'&&about.trim()?about.trim():undefined,facts:Array.isArray(facts)&&facts.some(f=>typeof f==='string'&&f.trim())?facts.filter(f=>typeof f==='string'&&f.trim()):[text.trim()],step:typeof step==='string'&&step?step:undefined,written:written===true?true:undefined};
 atomic(path.join(store.state,NOTICES_FILE),JSON.stringify({notices:[...notices,entry].slice(-KEEP)},null,2)+'\n');
 return true;
}
// Marks every notice not yet marked as not sent, and returns how many it marked. A missing file has
// nothing to mark; a file that exists and cannot be read throws, since writing it back would erase it.
export function holdQueuedNotices(store,{reason=NOT_SENT_BEFORE_SENDER,at=new Date().toISOString()}={}){
 const file=path.join(store.state,NOTICES_FILE);
 if(!fs.existsSync(file))return 0;
 const data=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Array.isArray(data?.notices))throw Error('The queued notices cannot be read');
 let marked=0;
 const notices=data.notices.map(n=>{if(!n||typeof n!=='object'||n.not_sent)return n;marked++;return {...n,not_sent:{reason,at}};});
 if(marked)atomic(file,JSON.stringify({...data,notices},null,2)+'\n');
 return marked;
}
